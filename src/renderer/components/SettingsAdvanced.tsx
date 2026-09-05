export function SettingsAdvanced() {
  return (
    <div style={{ padding: 8 }}>
      <fieldset>
        <legend>Advanced</legend>
        <p style={{ marginTop: 4 }}>
          비어 있습니다. 앞으로 여기에 붙일 것들:
        </p>
        <ul style={{ marginTop: 6, paddingLeft: 20 }}>
          <li>OpenClaw 게이트웨이 연결과 스킬 권한</li>
          <li>트리거 조건과 발화 빈도 (지금은 config.json)</li>
          <li>사이트 등록 목록 편집</li>
          <li>장기 기억 관리와 초기화</li>
          <li>사운드</li>
        </ul>
      </fieldset>
    </div>
  );
}
