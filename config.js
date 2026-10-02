// ---------------------------------------------------------------- 카카오 (지도 · 주소검색)
// developers.kakao.com > 앱 > 플랫폼 키 > "JavaScript 키". REST API 키가 아니다.
// 그 키 카드의 "JS SDK 도메인" 에 아래 둘을 등록해야 지도가 뜬다.
//   https://appassets.androidplatform.net   (APK 안의 웹뷰 출처)
//   http://localhost:8080                   (PC 미리보기)
// 그리고 제품 설정 > 카카오맵 을 켜야 한다. 꺼져 있으면 "disabled OPEN_MAP_AND_LOCAL service" 가 뜬다.

// ---------------------------------------------------------------- V-World (건물 외곽선)
// www.vworld.kr > 오픈API > 인증키 발급. 발급 때 적은 URL(도메인)로만 통과한다.
// VWORLD_DOMAIN  : 발급 때 등록한 도메인. 요청 파라미터로 같이 보낸다.
// VWORLD_REFERER : APK 안에서 네이티브가 요청할 때 박는 Referer. 보통 "https://" + VWORLD_DOMAIN.
//                  (웹뷰 출처 appassets.androidplatform.net 을 V-World 가 받아주는지는 미확인이라
//                   등록 도메인을 그대로 Referer 로 보내는 쪽을 택했다.)
// PC 미리보기(JSONP)는 localhost:8080 도 등록돼 있어야 한다.
window.SOLAR_CONFIG = {
  KAKAO_JS_KEY: '8cf550fc493131ae0b9e191c277069a9',

  VWORLD_KEY: 'B1A0B5BA-ED9E-403C-A16B-EF74FB25BD66',
  VWORLD_DOMAIN: 'https://sttvtts1-gif.github.io',
  VWORLD_REFERER: 'https://sttvtts1-gif.github.io/solar-web/',

  // 한전 전력데이터개방포털(bigdata.kepco.co.kr) Open API 인증키 — 분산전원연계정보(선로 여유용량) 조회
  KEPCO_KEY: '',
  // 웹 버전용 한전 중계(Apps Script 웹앱 URL). 웹 동기화 때 KEPCO_KEY 는 지워지고 이것만 남는다.
  KEPCO_PROXY: '',

  // 공공데이터포털 건축HUB 건축물대장정보 서비스 — 일반 인증키(Decoding)
  BLD_KEY: '',
};
