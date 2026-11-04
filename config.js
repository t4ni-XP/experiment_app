// ============================================================
// config.js — 質問文・アンカー定義・バージョン番号を集約
// 文言・アンカーの変更はこのファイルのみで完結させる
// （app.js 側に質問文をハードコードしない）
// ============================================================

const APP_VERSION = "2.0.0";

// ★【要確認】文言は仮訳。大門・土屋(2017)日本語版の確認後に差し替えること。
//   位置(value)も日本語版が原版と異なる場合は合わせて更新する。
const RSME_ANCHORS = [
  { value: 3,   label: "全く努力を要しなかった" },
  { value: 13,  label: "ほとんど努力を要しなかった" },
  { value: 26,  label: "わずかな努力を要した" },
  { value: 38,  label: "少しの努力を要した" },
  { value: 57,  label: "やや大きな努力を要した" },
  { value: 72,  label: "かなりの努力を要した" },
  { value: 87,  label: "大きな努力を要した" },
  { value: 102, label: "非常に大きな努力を要した" },
  { value: 114, label: "極度の努力を要した" }
];

const CONFIG = {
  appVersion: APP_VERSION,

  // localStorage キー
  storageKey: "survey_records_v1",
  sessionKey: "survey_session_v1",

  // 条件の一覧（実験1のセットアップで選ぶ）
  conditions: ["A", "B", "C"],

  // 実験者パネルを開く長押し時間（ミリ秒）
  panelLongPressMs: 1500,

  // 1問1画面の7段階リッカートになる質問（画面はここに挙げたぶんだけ作る）
  likertKeys: ["joa", "cause", "neg", "perf"],

  // ------------------------------------------------------------
  // 実験ごとの設定。セットアップ画面で選ぶ（並び順どおりに表示）
  //   flow:          回答画面の提示順。likertKeys の質問・"pred"・"rsme" を並べる
  //   conditionMode: "manual"   … セットアップで条件を1つ選び、セッション中は固定
  //                  "schedule" … 順序（orders）を選ぶと、走行番号から条件が自動で決まる
  //   csvFile:       CSV ファイル名の先頭（survey_{csvFile}{参加者ID}_{日付}.csv）
  //   questions:     この実験だけ質問の文言を変えるときに使う（questions の同じキーに上書き）
  //                  例: questions: { joa: { text: "…コントロールしていた感覚が…" } }
  //                  CSV の列名（joa など）は変わらない
  // ------------------------------------------------------------
  experiments: {
    exp1: {
      label: "実験1",
      description: "条件を1つ選び、全走行をその条件で回答",
      flow: ["joa", "perf", "pred", "rsme"],
      conditionMode: "manual",
      defaultPlannedRuns: 8,
      csvFile: "" // 実験1は従来どおり survey_P01_20260801.csv
    },
    exp2: {
      label: "実験2",
      description: "全員が条件Cを2回 → A・Bを2回ずつ（A・Bの順は参加者ごとに選ぶ）",
      flow: ["joa", "cause", "neg", "perf", "pred", "rsme"],
      conditionMode: "schedule",
      runsPerCondition: 2,
      orders: [
        { key: "CAB", label: "C → A → B", conditions: ["C", "A", "B"] },
        { key: "CBA", label: "C → B → A", conditions: ["C", "B", "A"] }
      ],
      csvFile: "exp2_"
    }
  },
  defaultExperiment: "exp2",

  questions: {
    // 1問1画面の7段階リッカート。どの実験で出すかは experiments.*.flow で決める
    // 行為主体感 ※【未決】「できた」か「していた」か
    //   代替案: "今回の走行では、車両の速度をコントロールしていた感覚がどの程度ありましたか？"
    joa: {
      shortLabel: "速度をコントロールできた感覚",
      text: "今回の走行では、車両の速度をコントロールできた感覚がどの程度ありましたか？",
      minLabel: "1＝全くなかった",
      maxLabel: "7＝非常にあった"
    },
    // 原因（実験2） ※【未決】「減速」か「速度の変化」か
    //   代替案: "今回の走行では、車両の速度の変化は自分の操作が引き起こしたものだと感じましたか？"
    cause: {
      shortLabel: "減速は自分の操作が引き起こした",
      text: "今回の走行では、車両の減速は自分の操作が引き起こしたものだと感じましたか？",
      minLabel: "1＝全くそう思わない",
      maxLabel: "7＝非常にそう思う"
    },
    // 否定的な項目（実験2） ※【未決】cause と同じく「減速」か「速度」か
    //   代替案: "今回の走行では、車両が自分の操作とは関係なく、ひとりでに速度が変わったと感じましたか？"
    neg: {
      shortLabel: "ひとりでに減速した",
      text: "今回の走行では、車両が自分の操作とは関係なく、ひとりでに減速したと感じましたか？",
      minLabel: "1＝全くそう思わない",
      maxLabel: "7＝非常にそう思う"
    },
    perf: {
      shortLabel: "運転のうまさ",
      text: "今回の走行では、どの程度うまく運転できましたか？",
      minLabel: "1＝全くうまくできなかった",
      maxLabel: "7＝非常にうまくできた"
    },
    // 支援システム予測可能性 3項目（7件法・同一ページで回答、RSMEの前に提示）
    // skipConditions に含まれる条件ではこの画面を出さない（CSVには空欄で出力）
    pred: {
      skipConditions: ["C"],
      instruction: "以下のそれぞれの文について、あなたの考えにあてはまる数字を選んでください。",
      minLabel: "1＝全くそう思わない",
      maxLabel: "7＝非常にそう思う",
      items: [
        { key: "pred1", shortLabel: "支援システムの動作を予測できた", text: "運転中に支援システムの動作を予測することができた" },
        // reversed: 逆転項目（画面には出さない。CSV は素点のまま。分析時に 8−x で反転する）
        { key: "pred2", shortLabel: "誰にも予測できない", text: "この支援システムの動きは、誰にも予測できないと思う", reversed: true },
        { key: "pred3", shortLabel: "何をするかわからない", text: "この支援システムは何をするかわからない", reversed: true }
      ]
    },
    rsme: {
      shortLabel: "努力の程度",
      text: "あなたは、今回の走行をおこなうのにどの程度の努力を要しましたか？　スケールに触れて、あてはまる位置に印を動かしてください。",
      min: 0,
      max: 150,
      tickStep: 10,       // 目盛の間隔
      majorTickStep: 50,  // 長い目盛の間隔
      anchors: RSME_ANCHORS
    }
  },

  messages: {
    wait: "次の走行が終わるまでお待ちください",
    complete: "全走行の回答が完了しました",
    saved: "回答を保存しました"
  }
};
