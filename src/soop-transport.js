import WebSocket from 'ws';
import { BroadcastOfflineError, RestrictedRoomError, ChannelResolutionError } from 'soop-chat';
// The pinned 0.6.0 core has socket injection; its public Node wrapper does not.
// Keep framing, decoding and reconnect behavior in that same tested core.
import { SoopChatCore } from '../node_modules/soop-chat/dist/client.js';

const API = 'https://live.sooplive.com/afreeca/player_live_api.php';
const packet = (opcode, payload) => {
  const bytes = Buffer.from(payload);
  return Buffer.concat([Buffer.from(`\x1b\t${opcode}${String(bytes.length).padStart(6, '0')}00`), bytes]);
};
function ticket(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 16_384 || /[\x00-\x1f\x7f]/.test(value)) throw new ChannelResolutionError('Invalid public chat ticket.');
  return value;
}

export async function resolveSoopPublicChannel(streamerId, { signal, fetchImpl = fetch } = {}) {
  async function request(type, broadcastNo = '') {
    const body = new URLSearchParams({ bid: streamerId, bno: broadcastNo, type, pwd: '', player_type: 'html5', stream_type: 'common', quality: 'HD', mode: 'landing', from_api: '0', is_revive: 'false' });
    const response = await fetchImpl(`${API}?bjid=${encodeURIComponent(streamerId)}`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]) });
    if (!response.ok) throw new ChannelResolutionError('Public live-info request failed.');
    const root = await response.json(), channel = root.CHANNEL || root;
    const code = Number(channel.RESULT ?? root.RESULT);
    if (code === 0) throw new BroadcastOfflineError(streamerId);
    if ([-6, -14, -1988].includes(code)) throw new RestrictedRoomError(code === -6 ? 'adult' : code === -14 ? 'subscriptionPlus' : 'password');
    if (code !== 1) throw new ChannelResolutionError('Public live-info response is unavailable.');
    return channel;
  }
  // Resolve the current broadcast first, then ask for its chat connection.
  // A saved URL may contain yesterday's broadcast number.
  const live = await request('live');
  if (!/^\d+$/.test(String(live.BNO || ''))) throw new ChannelResolutionError('Missing broadcast number.');
  const chat = await request('ch', String(live.BNO));
  if (String(chat.BNO) !== String(live.BNO) || (chat.BJID && chat.BJID !== streamerId)) throw new ChannelResolutionError('Resolved chat does not match this broadcast.');
  const channel = { broadcastNo: String(chat.BNO), chatNo: String(chat.CHATNO || ''), chatDomain: String(chat.CHDOMAIN || ''), chatPort: Number(chat.CHPT) };
  if (!/^\d+$/.test(channel.chatNo) || !/^chat[a-z0-9.-]*\.(?:sooplive\.com|sooplive\.co\.kr|afreecatv\.com)$/i.test(channel.chatDomain) || !Number.isInteger(channel.chatPort) || channel.chatPort < 1 || channel.chatPort > 65_534) throw new ChannelResolutionError('Invalid public chat connection.');
  return { channel, loginTicket: ticket(chat.TK), joinTicket: ticket(chat.FTK) };
}

export function createSoopPublicChat(options, { fetchImpl = fetch, socketFactory = (url, protocols) => new WebSocket(url, protocols), onChannel = () => {}, onTicketSent = () => {} } = {}) {
  let admission;
  return new SoopChatCore({
    ...options,
    resolveChannel: async (streamerId, context) => {
      const resolved = await resolveSoopPublicChannel(streamerId, { signal: context.signal, fetchImpl });
      context.signal?.throwIfAborted(); admission = resolved;
      onChannel({ ...resolved.channel, loginTicketPresent: Boolean(resolved.loginTicket), joinTicketPresent: Boolean(resolved.joinTicket) });
      // Anonymous FTK is returned without TK. Do not invent a login token to
      // satisfy the SDK's authentication shape requiring both nonempty values.
      return resolved.channel;
    },
    createWebSocket: (url, protocols) => {
      const socket = socketFactory(url, protocols), send = socket.send.bind(socket);
      socket.on('error', () => {});
      const session = admission;
      socket.send = (data, ...args) => {
        const opcode = Buffer.from(data).toString('ascii', 2, 6);
        if (opcode === '0001') data = packet('0001', `\f${session.loginTicket}\f\f16\f`);
        if (opcode === '0002') {
          const info = 'log\x11\x12pwd\x11\x12auth_info\x11\x12pver\x112\x12access_system\x11html5\x12';
          data = packet('0002', `\f${session.channel.chatNo}\f${session.joinTicket}\f0\f\f${info}\f`);
          onTicketSent({ loginTicketSent: Boolean(session.loginTicket), joinTicketSent: Boolean(session.joinTicket) });
        }
        return send(data, ...args);
      };
      return socket;
    }
  });
}
