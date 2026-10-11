import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { resolveSoopPublicChannel, createSoopPublicChat } from '../src/soop-transport.js';

const channel = { RESULT: 1, BJID: 'fixture', BNO: '123', CHATNO: '456', CHDOMAIN: 'chat.example.sooplive.com', CHPT: '9000', FTK: 'private-join-ticket' };
const response = data => ({ ok: true, json: async () => ({ CHANNEL: data }) });
test('public resolver uses the current broadcast chat API, validates tickets and blocks restricted/mismatched rooms', async () => {
  const calls=[];
  const result=await resolveSoopPublicChannel('fixture',{fetchImpl:async(url,options)=>{calls.push(Object.fromEntries(options.body));assert.equal(options.redirect,'error');return response(channel);}});
  assert.deepEqual(calls.map(c=>[c.type,c.bno]),[['live',''],['ch','123']]);
  assert.equal(result.joinTicket,'private-join-ticket'); assert.equal(result.loginTicket,'');
  for(const code of [-6,-14,-1988]) await assert.rejects(()=>resolveSoopPublicChannel('fixture',{fetchImpl:async()=>response({...channel,RESULT:code})}),e=>e.code==='RESTRICTED_ROOM');
  let n=0;
  await assert.rejects(()=>resolveSoopPublicChannel('fixture',{fetchImpl:async()=>response({...channel,BNO:++n===1?'123':'124'})}));
  await assert.rejects(()=>resolveSoopPublicChannel('fixture',{fetchImpl:async()=>response({...channel,FTK:'bad\fticket'})}));
  await assert.rejects(()=>resolveSoopPublicChannel('fixture',{fetchImpl:async()=>response({...channel,CHDOMAIN:'untrusted.example'})}));
});
test('anonymous FTK is sent in actual join frames and refreshed on reconnect without leaking ticket values', async t => {
  const server=new WebSocketServer({port:0});await once(server,'listening');
  t.after(()=>new Promise(r=>{for(const s of server.clients)s.terminate();server.close(r);}));
  const url=`ws://127.0.0.1:${server.address().port}`;
  const packet=(opcode,fields)=>{const b=Buffer.from('\f'+fields.join('\f')+'\f');return Buffer.concat([Buffer.from(`\x1b\t${opcode}${String(b.length).padStart(6,'0')}00`),b]);};
  let peer, joins=0, requests=0;const channels=[],sent=[],events=[];
  server.on('connection',s=>{peer=s;s.on('message',raw=>{
    const opcode=raw.toString().slice(2,6),fields=raw.toString().slice(14).split('\f');
    if(opcode==='0001'){assert.equal(fields[1],'');s.send(packet('0001',['guest','16']));}
    if(opcode==='0002'){joins++;assert.equal(fields[1],'456');assert.equal(fields[2],`private-ticket-${joins*2}`);assert.equal(fields[3],'0');assert.ok(raw.toString().includes('access_system\x11html5'));s.send(packet('0002',['456','fixture','','5','0','','16']));}
  });});
  const chat=createSoopPublicChat({streamerId:'fixture',reconnect:{initialDelayMs:10,maxDelayMs:10,jitter:0}}, {fetchImpl:async()=>response({...channel,FTK:`private-ticket-${++requests}`}),socketFactory:()=>new WebSocket(url),onChannel:c=>channels.push(c),onTicketSent:s=>sent.push(s)});
  t.after(()=>chat.disconnect());chat.on('event',e=>events.push(e));
  await chat.connect();assert.equal(joins,1);
  peer.send(packet('0018',['fixture','donor','닉네임','5','1','','1','0','','0']));
  for(let i=0;i<100&&!events.some(e=>e.type==='sendBalloon');i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(events.find(e=>e.type==='sendBalloon').data.count,5);
  peer.terminate();
  for(let i=0;i<100&&joins<2;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(joins,2);assert.equal(requests,4);
  assert.ok(sent.every(s=>s.joinTicketSent&&!s.loginTicketSent));
  assert.ok(channels.every(c=>c.joinTicketPresent));
  assert.ok(!JSON.stringify({channels,sent}).includes('private-ticket-'));
});
