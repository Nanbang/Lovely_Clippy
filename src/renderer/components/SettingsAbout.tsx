export function SettingsAbout() {
  return (
    <div style={{ padding: 8, overflowY: "auto" }}>
      <h2 style={{ marginTop: 0 }}>About</h2>

      <fieldset>
        <legend>이 프로그램</legend>
        <p style={{ marginTop: 4 }}>
          화면을 지켜보다가 제멋대로 튀어나와 참견하는 클리피입니다. 무엇을 하고
          있는지, 얼마나 오래 했는지, 오늘 몇 번째인지를 세고 있다가 적당히
          무례한 말을 겁니다.
        </p>
      </fieldset>

      <fieldset>
        <legend>바탕이 된 것</legend>
        <p style={{ marginTop: 4 }}>
          Felix Rieseberg 의 Clippy 데스크톱 앱을 개조해서 만들었습니다. 캐릭터
          렌더링, 애니메이션 재생기, 98년도 UI, 말풍선 창이 그 프로젝트에서
          왔습니다. 원본은 로컬 LLM 을 돌리는 앱이었고, 이 개조판은 그 부분을
          걷어내고 클라우드 모델과 화면 감시 기능을 붙였습니다.
        </p>
        <p>
          98년도 UI 디자인은 Jordan Scales 의 98.css, 스프라이트 프레임 추출은
          Pooya Parsa 의 작업입니다.
        </p>
      </fieldset>

      <fieldset>
        <legend>캐릭터</legend>
        <p style={{ marginTop: 4 }}>
          클리피는 일러스트레이터 Kevan Atteberry 가 디자인했습니다. 그는
          마이크로소프트 오피스 어시스턴트 후보로 15종이 넘는 캐릭터를
          만들었습니다.
        </p>
        <p>
          클리피와 관련된 모든 시각 자산은 마이크로소프트의 소유입니다. 이
          프로그램은 마이크로소프트와 아무 관련이 없으며 승인받지도
          않았습니다. 개인적으로 쓰는 물건입니다.
        </p>
      </fieldset>

      <fieldset>
        <legend>화면 정보</legend>
        <p style={{ marginTop: 4 }}>
          활성 창의 제목과 프로그램 이름을 주기적으로 읽습니다. 체류 시간과
          횟수는 전부 이 컴퓨터에서만 계산됩니다. 발화할 때만 그 요약이 모델로
          전송되며, 화면을 캡처하거나 이미지를 보내지는 않습니다.
        </p>
      </fieldset>
    </div>
  );
}
