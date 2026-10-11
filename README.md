# 메소 라이브 룰렛

Node.js 기반 후원 메소 룰렛과 OBS 브라우저 오버레이입니다. 기본 시작 메소는 **30,000,000**, 음수 잔액은 기본 허용입니다.

## Windows 11 64비트 배포본

[0.0.3-beta.3 베타](https://github.com/yukwanwoo/apiSetting/releases/tag/v0.0.3-beta.3): Windows EXE는 AppData와 DATA_DIR 환경 변수를 무시하고 EXE 옆 `data/`만 사용합니다. 자동 이전도 제거했습니다. beta.2의 SOOP 입장 티켓 전달과 진단을 유지하며, 사용자 진단에서 별풍선 3건 수신과 해석 오류 0건이 확인됐습니다.

[0.0.2 Release](https://github.com/yukwanwoo/apiSetting/releases/tag/v0.0.2)에서 ZIP을 내려받아 압축을 풀고 `MesoLiveRoulette-0.0.2-win-x64.exe`를 실행하세요. Node.js 설치나 관리자 권한 없이 브라우저 관리 화면이 자동으로 열립니다. 방송 중에는 실행 창을 열어 두세요.

ZIP에는 EXE와 `data/`를 포함한 하나의 폴더가 들어 있습니다. 설정·잔액·인증 정보는 **EXE 옆 `data/`**에 저장됩니다. 새 버전으로 업데이트할 때 기존 `data/`를 새 EXE 옆으로 옮기거나 EXE만 교체하세요. 폴더를 통째로 이동해도 설정은 유지됩니다. beta.3부터 AppData는 읽거나 자동 복사하지 않으며 EXE 실행에서는 DATA_DIR 환경 변수도 무시합니다. 이미 EXE 옆에 저장된 데이터는 유지됩니다. 배포본은 코드 서명되지 않아 SmartScreen 경고가 나올 수 있습니다. 상세 사용법은 [Windows 안내](docs/WINDOWS.txt)를 참고하세요.

Windows x64 / Node.js 24.19.0에서 `npm ci`, `npm run build:windows`, `npm run smoke:exe`로 빌드와 실제 EXE 검증을 실행합니다. Node.js SEA에 서버와 화면 파일을 내장합니다. GitHub Actions는 Windows에서 테스트·EXE 검증을 통과한 버전 태그를 Release로 게시합니다.

## 소스 코드 실행

Node.js 24 이상이 필요합니다. `soop-chat@0.6.0`과 `ws@8.21.3`을 고정 버전으로 사용하며 `npm ci`로 설치합니다.

```sh
git clone https://github.com/yukwanwoo/apiSetting.git
cd apiSetting
npm ci
npm start
```

로컬 컴퓨터에서는 `http://127.0.0.2:3000`을 열고 `data/keys.json`의 `admin` 값을 관리자 키로 입력합니다. 키는 첫 실행 시 생성되며 콘솔에는 출력하지 않습니다. `data/`에는 인증 정보와 방송 기록이 있으므로 공유하거나 Git에 커밋하지 마세요.

개발 모드: `npm run dev`. 별도 환경 변수 파일 사용: `.env.example`을 `.env`로 복사해 값을 설정하고 `node --env-file=.env src/server.js`로 실행합니다. `.env`는 자동 로드되지 않습니다.

기본 서버는 로컬 주소에만 바인딩합니다. 다른 컴퓨터의 OBS에서 사용하려면 접근 가능한 서버 주소와 `HOST`, `PORT`를 설정해야 합니다. 외부 공개 시 HTTPS 리버스 프록시와 접근 제어가 필요합니다. 클라우드에서 실행한 주소는 사용자 PC의 localhost와 같지 않습니다.

## 현재 구현 범위

| 기능 | 상태 |
| --- | --- |
| 공격·방어 룰렛, 조건 금액·확률·시간 편집 | 구현 |
| 0.1% 확률, 합계 100%, 결과별 0~1천만 메소 | 구현 |
| 정확한 후원 금액 일치 시 1회 실행, 1별풍선 = 100원 | 구현 |
| 기본 3천만 메소, 음수 허용, 시작 잔액 설정·초기화 | 구현 |
| OBS 투명 룰렛·잔액 오버레이, 실시간 갱신 | 구현 |
| 치지직 공개 방송 URL + 채팅 이벤트 | 구현: CHAT / VIDEO 후원. 개발자 앱 없이 사용 가능한 비공식 URL 모드 |
| 치지직 OAuth 인증 + 공식 후원 이벤트 구독 | 구현: 선택적 공식 모드, CHAT / VIDEO 후원 |
| SOOP 공개 방송 URL + 실시간 채팅 후원 이벤트 | 구현: 별풍선 / 서브 채널 별풍선 / 영상 별풍선. 비공식 SDK 사용 |
| 투네이션 알림 위젯 URL + WebSocket 후원 이벤트 | 구현: 위젯 code 101의 원화 후원. 비공식 위젯 프로토콜 사용 |
| YouTube OAuth + Super Chat·Super Sticker | 구현: KRW 후원 |
| 실제 방송 계정·유료 후원 수신 검증 | 미실행. 계정 동의·유효한 위젯 URL이 필요 |

누구나 자신의 방송을 설정할 수 있는 **설치형 앱**입니다. 채널이나 후원 계정이 코드에 고정되어 있지 않습니다. 설치마다 하나의 방송자 설정·메소 잔액을 갖습니다. 하나의 공개 웹사이트에 여러 방송자가 로그인하여 독립된 잔액을 갖는 멀티테넌트 SaaS는 아직 구현하지 않았습니다.

치지직 공개 URL 모드·SOOP·투네이션은 개발자 앱 없이 URL로 연결합니다. 치지직 공식 모드·YouTube는 서비스 운영자가 개발자 앱을 등록하고 방송자는 계정 연결 버튼으로 동의합니다. 개인 PC에 설치하는 경우 설치자가 운영자이므로 처음에는 개발자 앱 설정이 필요합니다. 운영자 설정은 연결 화면의 접힌 별도 패널에 있습니다.

‘연결 필요’ → ‘연결 중’ → ‘수신 대기’ → ‘후원 수신 확인’을 구분합니다. 소켓이 열렸거나 URL을 저장한 것만으로 유료 후원 수신이 검증된 것으로 표시하지 않습니다. 모의 후원이나 로컬 소켓 테스트는 실제 플랫폼·유료 결제 검증을 대신하지 않습니다.

## 룰렛 설정

- 기본 공격 조건: 1,000원. 기본 방어 조건: 1,100원. 둘 다 편집할 수 있습니다.
- 조건 금액에 **정확히 일치**하는 후원만 해당 룰렛을 한 번 실행합니다. 큰 금액을 나누어 여러 번 돌리지 않습니다.
- 활성 룰렛의 조건 금액은 중복할 수 없습니다. 여러 룰렛을 추가해 금액별로 구분할 수 있습니다.
- 확률은 0.1% 단위, 합계는 정확히 100%. 0% 항목은 추첨되지 않습니다. 내부 확률은 0~1000의 정수입니다.
- 공격은 메소를 더하고 방어는 뺍니다. 방어 항목에도 양의 메소 크기를 입력하면 화면에서 음수로 표시됩니다.
- 애니메이션 시간 0.1~60초, 결과 표시 시간 0~30초. 대기열의 총 처리 시간은 둘의 합계입니다.
- 기본 메소 항목: 0부터 1천만까지 100만 단위의 11개 항목. 기본 확률: 0메소 9.0%, 나머지 각 9.1% (합계 100%). 방어는 같은 크기의 메소를 차감합니다. 기존에 직접 편집한 규칙은 유지하며 이전 기본 항목·금액 그대로인 룰렛만 새 기본값으로 갱신합니다.
- 새 설정은 다음 후원부터 적용됩니다. 진행 중이거나 대기 중인 후원은 수신 당시 항목·시간을 유지합니다.
- 음수를 끄면 잔액은 0에서 멈춥니다. 잔액 한도는 ±1조 메소이며 한도 적용 시 실제 증감을 따로 표시합니다.
- 시작 메소 설정은 저장만으로 현재 잔액을 바꾸지 않습니다. ‘저장된 시작 메소로 초기화’ 버튼을 사용하세요.
- 테스트 후원도 잔액에 반영되며 기록에 테스트로 표시됩니다. 잔액 변경·초기화는 대기열이 모두 끝난 후 가능합니다.

## OBS

관리자 대시보드 → **연결 & OBS**에서 주소를 복사해 OBS의 브라우저 소스에 붙여 넣습니다.

- 룰렛 오버레이: `/overlay.html?token=...`, 권장 800 × 800.
- 메소 잔액 오버레이: `/meso.html?token=...`, 권장 640 × 220.
- 룰렛은 회전과 결과 표시 시간이 끝나면 완전히 숨습니다. 메소 잔액 화면은 계속 표시됩니다. 대시보드 미리보기는 대기 중에도 룰렛 견본을 표시합니다.
- 설정의 **룰렛 알림음**에서 기본 알림음 음량을 0~100%로 조절하고 저장하세요. 0%는 음소거이며, 회전 시작 시 한 번 재생합니다. 미리보기와 메소 화면은 무음입니다. OBS에서 브라우저 소스의 ‘OBS를 통해 오디오 제어’를 켜고 오디오 믹서에서 음소거·출력 설정을 확인하세요.
- 배경은 투명합니다. 룰렛 당첨은 서버에서 확정되므로 OBS 창 개수와 무관하게 메소가 한 번만 반영됩니다.
- URL 키는 오버레이 읽기 전용이며 관리자 설정을 변경할 수 없습니다. 표시 중인 후원자 정보가 포함되므로 주소를 공개하지 마세요.
- 연결이 끊기면 자동 재연결합니다. 진행 중인 룰렛에 재접속하면 서버 시각을 기준으로 같은 결과에 맞춰 회전을 복구합니다.

## YouTube 계정 연결

서비스 제공자가 먼저 Google Cloud에서 YouTube Data API v3를 활성화하고 OAuth 웹 애플리케이션을 등록해야 합니다. 이후 방송자는 연결 화면의 **Google로 YouTube 연결** 버튼으로 인증합니다.

1. Google OAuth 동의 화면을 구성하고 테스트 모드라면 연결할 계정을 테스트 사용자에 추가합니다.
2. ‘연결 & OBS’에서 OAuth Client ID / Client Secret을 저장합니다. 인증 값은 로컬 `data/connections.json`에 보관하고 브라우저에 다시 반환하지 않습니다.
3. 화면에 표시된 리디렉션 URI를 Google 앱의 승인된 리디렉션 URI에 정확히 등록합니다. 기본값은 `http://127.0.0.2:3000/oauth/youtube/callback`입니다.
4. 관리자 페이지도 동일한 기본 주소로 접속하세요. 서비스 도메인 사용 시 서버의 `PUBLIC_BASE_URL=https://...`을 지정하고 그 URI를 등록합니다.
5. YouTube 방송 URL을 저장하고 계정 연결을 진행합니다. 읽기 전용 `youtube.readonly` 권한을 요청합니다.
6. 라이브 방송을 시작하고 연결 상태가 ‘연결됨’인지 확인합니다. 연결됨은 API 응답 성공을 뜻하며 실제 유료 후원 검증은 별도로 필요합니다.

대안으로 `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`을 서버 환경 변수에 설정할 수 있습니다. 또는 만료 전까지 사용할 `YOUTUBE_ACCESS_TOKEN`을 설정할 수 있습니다. 환경 변수는 UI 값보다 우선하며 UI에서 제거되지 않습니다. `YOUTUBE_LIVE_CHAT_ID`는 방송 URL보다 우선합니다. 방송 URL·채팅 ID가 없다면 인증한 계정의 활성 방송 하나를 조회합니다.

조회 주기는 API의 `pollingIntervalMillis`를 따릅니다. 페이지 커서·이벤트 ID는 재시작 후에도 유지합니다. Super Chat / Super Sticker의 **KRW 후원만** 처리합니다. 외화 후원은 환율 규칙이 정해지지 않아 제외 건수를 표시합니다. 멤버십·선물·일반 채팅은 금액 후원 이벤트로 취급하지 않습니다. API 쿼터·방송 종료·인증 만료 오류는 연결 상태에 표시됩니다. 첫 조회가 반환하는 기존 채팅의 유료 후원도 처리하므로 방송 시작 전에 연결하세요.

필요한 HTTPS 목적지는 `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`입니다. 네트워크 제한 환경에서는 허용해야 합니다. 실제 Google 계정 인증이나 유료 후원 수신은 검증하지 않았습니다.

공식 API 참고: [Live chat messages](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list), [OAuth 웹 서버 흐름](https://developers.google.com/identity/protocols/oauth2/web-server).

## 치지직 연결

**간단한 URL 모드 (기본값)**: 방송 URL을 저장하고 ‘저장한 치지직 방송 연결’을 누릅니다. 개발자 앱·로그인·쿠키 없이 공개 방송의 후원 채팅을 읽습니다. [kimcore/chzzk 1.10.4](https://github.com/kimcore/chzzk)의 공개 채팅 프로토콜을 참고한 자체 읽기 전용 수신 코드이며 비공식 방식입니다. 라이브 채팅용 익명 접근 토큰을 메모리에서만 사용하고 과거 최근 채팅을 요청하거나 새 후원으로 재처리하지 않습니다. 성인 등 제한 방송에서는 연결을 중단합니다. 미션은 실패·상태 변경 이벤트가 실제 지급과 다를 수 있어 현재 제외합니다.

**공식 계정 모드 (선택)**:

1. 운영자가 [치지직 개발자 센터](https://developers.chzzk.naver.com)에서 앱을 등록하고 **유저 정보 조회**와 **후원 조회** 권한을 활성화합니다.
2. 운영자 설정에서 Client ID/Secret을 입력하거나 서버의 `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`을 설정합니다.
3. 화면에 표시되는 로그인 리디렉션 URI를 등록합니다. 기본값은 `http://127.0.0.2:3000/oauth/chzzk/callback`입니다. 서버 공개 시 `PUBLIC_BASE_URL`을 실제 HTTPS origin으로 설정하세요.
4. 방송자가 **치지직 계정 연결**을 눌러 본인 계정으로 로그인하고 동의합니다. 입력한 방송 URL이 있다면 인증한 채널과 일치해야 하며, URL이 없으면 인증 계정의 채널을 사용합니다.
5. 공식 사용자 세션 생성 → Engine.IO v3 WebSocket 연결 → 후원 구독 순서로 CHAT / VIDEO 후원을 받습니다. 접속 실패 시 10초 뒤 재시도하고 권한 해제 시 재인증을 안내합니다.

Access Token과 일회용으로 회전하는 Refresh Token은 서버의 보호 파일에 보관합니다. `CHZZK_ACCESS_TOKEN` / `CHZZK_REFRESH_TOKEN`으로 초기 인증을 주입할 수도 있으나 갱신된 토큰은 반드시 유지되는 `data/`에 보관해야 합니다. 개발자 앱 값은 환경 변수가 우선합니다.

공식 문서가 지정한 Socket.IO 1~2.0.3 / Engine.IO v3의 WebSocket 전송을 직접 구현해 오래된 Socket.IO npm 의존성을 추가하지 않았습니다. 공식 근거: [인증](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization), [세션과 후원](https://chzzk.gitbook.io/chzzk/chzzk-api/session), [유저](https://chzzk.gitbook.io/chzzk/chzzk-api/user).

## SOOP 연결

방송 URL을 저장하고 **저장한 SOOP 방송 연결**을 누릅니다. `https://play.sooplive.com/방송인ID/방송번호`와 기존 `play.sooplive.co.kr` 주소를 지원합니다. 매번 최신 방송·채팅방 정보를 조회해 연결하고, 방송 종료 후 다시 시작하는지 확인합니다.

[soop-chat](https://github.com/joyfuI/soop-chat) 0.6.0의 읽기 전용 공개 채팅 기능을 사용합니다. 공식 OAuth 후원 조회 API라고 주장하지 않습니다. 플랫폼의 채팅 프로토콜 변경 시 수정이 필요할 수 있습니다.

지원 후원은 `sendBalloon`, `sendBalloonSub`, `videoBalloon`입니다. 실제 개수를 읽어 1개당 100원으로 환산합니다. 서로 다른 수신 이벤트는 닉네임·금액·팬클럽 순번이 같아도 각각 처리합니다.

**성인·구독플러스·비밀번호 제한 방송은 현재 지원하지 않습니다.** 접근 제한을 우회하거나 계정 쿠키·비밀번호를 수집하지 않습니다. 스티커·애드벌룬·구독 선물은 별풍선으로 임의 환산하지 않으며 VOD 후원 합계 알림은 과거 이벤트의 중복 합산을 피하기 위해 제외합니다. 미션 후원·정산 또한 현재 룰렛 대상이 아닙니다.

## 투네이션 연결

1. 본인 투네이션 스트리머 설정에서 OBS에 넣는 **알림 위젯 / 알림창 URL**을 복사합니다.
2. 연결 화면의 투네이션 알림 위젯 칸에 붙여 넣고 연결합니다. 형식은 `https://toon.at/widget/alertbox/…`입니다.
3. `https://toon.at/donate/…`는 일반 시청자 후원 페이지이므로 알림 수신 연결에 사용할 수 없습니다.
4. 서버가 해당 위젯에서 payload를 읽어 `wss://ws.toon.at/…`에 연결하고 12초마다 WebSocket ping을 보냅니다. 토큰을 브라우저에 다시 반환하지 않으며 원격 JavaScript를 실행하지 않습니다.
5. code 101의 `content.name` / `content.amount` 원화 이벤트를 후원으로 처리합니다. 명시적인 `is_test` 테스트 알림은 잔액에 반영하지 않고 수신 확인만 표시합니다.

위젯 URL은 권한을 포함한 비밀 정보이므로 공개·로그·커밋하지 마세요. 서버의 `data/connections.json`에만 저장합니다. 연결 해제 버튼은 저장된 위젯 URL도 삭제합니다. 위젯에 활성화된 알림 종류·최소 금액·필터에 따라 받을 수 있는 후원이 달라질 수 있으므로 모든 금액을 포함하도록 위젯 설정을 확인하세요. 과거 후원 목록은 조회하지 않습니다.

투네이션 공식 제휴 API가 아닌 **알림 위젯 프로토콜**입니다. 버전 변경이나 형식 미지원은 연결 화면에 오류로 표시합니다. 연결 방식 참고: [후원 알림 파싱 예제](https://github.com/nomomo/Twip-Toonation-Afreehp-Parser-Example). 실제 본인 위젯 URL로 최종 검증이 필요합니다.

## 네트워크 목적지

| 플랫폼 | 필요한 호스트 |
| --- | --- |
| 치지직 | `chzzk.naver.com`, `api.chzzk.naver.com`, `comm-api.game.naver.com`, `*.chat.naver.com` (URL 모드), `openapi.chzzk.naver.com`, `*.nchat.naver.com` (공식 모드) |
| SOOP | `live.sooplive.com`, SOOP API가 반환하는 채팅 호스트 (`*.sooplive.com` 등) |
| 투네이션 | `toon.at`, `ws.toon.at` |
| YouTube | `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` |

네트워크 제한 환경에서는 HTTPS뿐 아니라 WebSocket 연결도 허용해야 합니다. SOOP 채팅은 API가 반환하는 전용 포트(`chatPort + 1`)를 사용하므로 호스트만 허용하고 포트를 차단하면 연결되지 않습니다. 앱은 기본 시스템 TLS 검증을 유지하며 TLS·서명 검증을 끄지 않습니다.

## 외부 후원 브리지 계약

직접 연결 어댑터 외에 별도 브리지를 사용하려는 경우 기존 서명 수신 API도 유지합니다. **이 앱의 자체 계약**이며 플랫폼 원본 페이로드와 다릅니다.

`POST /webhooks/chzzk`, `/webhooks/soop`, `/webhooks/youtube`, `/webhooks/toonation`

```json
{
  "eventId": "platform-unique-donation-id",
  "nickname": "후원자",
  "amount": 10,
  "unit": "STAR"
}
```

`unit`은 KRW 또는 SOOP 전용 STAR입니다. 예시는 별풍선 10개 = 1,000원입니다. 브리지는 재전송할 때 같은 eventId를 유지해야 합니다.

- `X-Webhook-Timestamp`: 현재 Unix 시간, 밀리초 문자열. 5분 이상 차이나면 거절.
- `X-Webhook-Signature`: `HMAC-SHA256(WEBHOOK_SECRET, timestamp + "." + rawBody)`의 hex 문자열.
- `Content-Type: application/json`

`WEBHOOK_SECRET`은 환경 변수 또는 `data/keys.json`의 webhook입니다. 직접 연결과 외부 브리지를 동시에 같은 후원에 사용하면 서로 다른 ID 때문에 중복 반영될 수 있으므로 하나를 선택하세요.

## 저장·운영 제한

`data/state.json`에 설정·잔액·대기열·결과·중복 방지 ID·YouTube 페이지 커서를 저장합니다. 임시 파일 쓰기 후 rename으로 교체하고 재시작 시 진행 중인 당첨 결과를 유지합니다. 최근 후원·결과는 각 500건까지 보관하고 중복 방지 ID는 삭제하지 않습니다.

중복 방지는 **안정적인 동일 eventId를 가진 이벤트**에 적용됩니다. 치지직 공식 후원 메시지와 SOOP 채팅·일부 위젯 버전에는 거래 고유 ID가 없으므로 연결 세션과 수신 순번으로 delivery ID를 생성합니다. 동일 닉네임·금액·본문을 해시해 서로 다른 실제 후원을 잘못 합치지 않습니다. 연결이 끊긴 동안의 이벤트 복구나 소스의 재전송에 대한 exactly-once 보장은 하지 않습니다. 이 앱은 회계 원장 용도가 아닙니다.

단일 Node.js 프로세스용입니다. 같은 DATA_DIR에 여러 서버를 실행하지 마세요. 다른 방송자는 별도 설치·DATA_DIR을 사용해야 합니다. 큰 규모 운영·멀티테넌트 서비스는 트랜잭션 DB, 사용자 인증·데이터 격리, 인증 토큰 관리와 큐 보관 정책을 추가해야 합니다. 대기열은 최대 1,000건이며 형식 오류·대기열 포화·디스크 오류로 처리가 실패하면 수신 상태에 오류를 표시합니다. 플랫폼 직접 이벤트의 재전송은 보장되지 않습니다.

클라우드 작업은 기존 `/workspace/apiSetting` 체크아웃을 사용하며 별도 Git worktree가 필요하지 않습니다. 스냅샷에는 프로세스가 유지되지 않으므로 새 작업에서는 서버를 다시 시작합니다.

## 검증

```sh
npm run check
npm test
```

44개 테스트가 룰렛·잔액·중복 ID·서명·SSE와 플랫폼 어댑터를 검증합니다. 치지직 공개 채팅 로그인·후원 프레임 및 공식 Engine.IO 세션/구독 프레임, SOOP SDK의 바이너리 로그인·입장·별풍선 프레임, 투네이션 WebSocket 메시지를 **로컬 서버로 재현하여 메소 정산까지** 확인합니다. OAuth 응답은 모의 응답입니다. 실제 플랫폼 계정·유료 결제 수신은 검증하지 않았습니다.

선택적 브라우저 검증: Python Playwright와 Chromium이 설치된 환경에서 `python3 scripts/browser-smoke.py`를 실행합니다. 기존 서버·방송 잔액을 바꾸지 않고 임시 데이터·별도 포트를 사용합니다. `CHROMIUM_PATH`와 `MESO_SCREENSHOTS_DIR`를 지정할 수 있습니다. 관리자 로그인, 룰렛 편집·회전·잔액, OBS 갱신, 모바일 화면, 연결 UI, 잘못된 투네이션 URL 차단, 운영자 앱 설정과 비밀 입력 지우기를 검사합니다.

환경 설정 초안 저장은 실행 중인 네트워크 변경이나 게시 완료를 의미하지 않습니다. 초안 변경이 있다면 환경 설정에서 검토·저장 후 게시해야 재사용 환경에 적용됩니다.
