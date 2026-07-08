// ============================================================
// config.js — 質問文・アンカー定義・バージョン番号を集約
// 文言・アンカーの変更はこのファイルのみで完結させる
// （app.js 側に質問文をハードコードしない）
// ============================================================

const APP_VERSION = "1.0.0";

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

  // セットアップ画面のデフォルト
  defaultPlannedRuns: 8,
  conditions: ["A", "B", "C"],

  // 実験者パネルを開く長押し時間（ミリ秒）
  panelLongPressMs: 1500,

  questions: {
    joa: {
      shortLabel: "速度をコントロールできた感覚",
      text: "今回の走行では、車両の速度をコントロールできた感覚がどの程度ありましたか？",
      minLabel: "1＝全くなかった",
      maxLabel: "7＝非常にあった"
    },
    perf: {
      shortLabel: "運転のうまさ",
      text: "今回の走行では、どの程度うまく運転できましたか？",
      minLabel: "1＝全くうまくできなかった",
      maxLabel: "7＝非常にうまくできた"
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
