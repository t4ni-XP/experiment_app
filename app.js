/* ============================================================
   走行後主観評価アプリ — ロジック
   ・回答データは localStorage のみに保存（ネットワーク送信なし）
   ・質問文・アンカーは config.js から読む（ここにハードコードしない)
   ============================================================ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------- 状態 ----------
  let session = null; // {participant, condition, plannedRuns, currentRun}
  const PRED_KEYS = CONFIG.questions.pred.items.map((it) => it.key);
  // 現在の条件で予測可能性画面を出すか（skipConditions の条件では出さない）
  function predEnabled() {
    return session && CONFIG.questions.pred.skipConditions.indexOf(session.condition) === -1;
  }
  function emptyDraft() {
    const d = { joa: null, perf: null, rsme: null };
    PRED_KEYS.forEach((k) => { d[k] = null; });
    return d;
  }
  let draft = emptyDraft();
  let fromConfirm = false; // 確認画面の「修正」から来たか

  // ---------- ストレージ ----------
  function loadRecords() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }
  function saveRecords(records) {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(records));
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem(CONFIG.sessionKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveSession() {
    if (session) {
      localStorage.setItem(CONFIG.sessionKey, JSON.stringify(session));
    } else {
      localStorage.removeItem(CONFIG.sessionKey);
    }
  }

  function unexportedCount() {
    return loadRecords().filter((r) => !r.exported).length;
  }

  // タイムゾーンオフセット付きISO文字列（例: 2026-08-01T10:23:45.678+09:00）
  function localISOString(d) {
    d = d || new Date();
    const pad = (n, w) => String(n).padStart(w || 2, "0");
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
      "." + pad(d.getMilliseconds(), 3) +
      sign + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60)
    );
  }

  // ---------- 画面切替 ----------
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => {
      s.classList.toggle("active", s.id === id);
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 1600);
  }

  // 参加者×走行の回答済み数（進捗表示用）
  function answeredRuns(participant) {
    const runs = new Set();
    loadRecords().forEach((r) => {
      if (r.participant === participant) runs.add(r.run);
    });
    return runs.size;
  }

  function progressText() {
    return (
      session.participant + " ｜ " +
      answeredRuns(session.participant) + "/" + session.plannedRuns + "走行 回答済み"
    );
  }

  // ============================================================
  // セットアップ画面
  // ============================================================
  let setupCondition = null;

  function initSetup() {
    // 条件ボタン
    const group = $("condition-group");
    group.innerHTML = "";
    CONFIG.conditions.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c;
      b.addEventListener("click", () => {
        setupCondition = c;
        group.querySelectorAll("button").forEach((x) => {
          x.classList.toggle("selected", x.textContent === c);
        });
      });
      group.appendChild(b);
    });

    $("inp-planned").value = CONFIG.defaultPlannedRuns;

    // 前回セッションの復元（Safari再起動などで中断した場合の再開用）
    const prev = loadSession();
    if (prev) {
      $("inp-participant").value = prev.participant;
      $("inp-startrun").value = prev.currentRun;
      $("inp-planned").value = prev.plannedRuns;
      setupCondition = prev.condition;
      group.querySelectorAll("button").forEach((x) => {
        x.classList.toggle("selected", x.textContent === prev.condition);
      });
      const note = $("setup-resume-note");
      note.textContent =
        "前回のセッションを検出しました（" + prev.participant + "・条件" +
        prev.condition + "・次は走行" + prev.currentRun + "）。内容を確認して再開してください。";
      note.classList.remove("hidden");
    }

    $("btn-start").addEventListener("click", startSession);
  }

  function startSession() {
    const err = $("setup-error");
    err.classList.add("hidden");

    const participant = $("inp-participant").value.trim();
    const startRun = parseInt($("inp-startrun").value, 10);
    const planned = parseInt($("inp-planned").value, 10);

    if (!participant) return showSetupError("参加者IDを入力してください。");
    if (!setupCondition) return showSetupError("条件を選択してください。");
    if (!(startRun >= 1)) return showSetupError("開始走行番号は1以上で入力してください。");
    if (!(planned >= 1)) return showSetupError("予定走行数は1以上で入力してください。");

    // 二重記録の警告（同一 参加者ID×走行番号 が既に存在する場合）
    const exists = loadRecords().some(
      (r) => r.participant === participant && r.run === startRun
    );
    if (exists) {
      const ok = window.confirm(
        "警告：" + participant + " の走行" + startRun +
        " の記録が既に存在します。\nこのまま進むと、回答確定時に上書きの確認が表示されます。\n続行しますか？"
      );
      if (!ok) return;
    }

    session = {
      participant: participant,
      condition: setupCondition, // セッション中はロック（セットアップに戻るまで変更不可）
      plannedRuns: planned,
      currentRun: startRun
    };
    saveSession();
    startRunFlow();
  }

  function showSetupError(msg) {
    const err = $("setup-error");
    err.textContent = msg;
    err.classList.remove("hidden");
  }

  // ============================================================
  // 参加者回答フロー（JoA → パフォーマンス → 支援システム予測可能性 → RSME → 確認）
  // ※予測可能性は skipConditions の条件（例：C）ではスキップ
  // ============================================================
  function startRunFlow() {
    draft = emptyDraft();
    fromConfirm = false;
    renderLikert("joa");
    show("screen-joa");
  }

  // ---------- リッカート（joa / perf 共通） ----------
  function initLikertScreens() {
    ["joa", "perf"].forEach((key) => {
      const q = CONFIG.questions[key];
      $(key + "-text").textContent = q.text;
      $(key + "-min").textContent = q.minLabel;
      $(key + "-max").textContent = q.maxLabel;

      const wrap = $(key + "-likert");
      for (let v = 1; v <= 7; v++) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = v;
        b.addEventListener("click", () => {
          draft[key] = v;
          renderLikert(key);
        });
        wrap.appendChild(b);
      }

      $(key + "-next").addEventListener("click", () => {
        if (draft[key] == null) return;
        if (fromConfirm) {
          fromConfirm = false;
          showConfirm();
        } else if (key === "joa") {
          renderLikert("perf");
          show("screen-perf");
        } else if (predEnabled()) {
          renderPred();
          show("screen-pred");
        } else {
          renderRsme();
          show("screen-rsme");
        }
      });
    });
  }

  function renderLikert(key) {
    $(key + "-likert").querySelectorAll("button").forEach((b) => {
      b.classList.toggle("selected", Number(b.textContent) === draft[key]);
    });
    $(key + "-next").disabled = draft[key] == null;
  }

  // ---------- 支援システム予測可能性（3項目・同一ページ） ----------
  function initPred() {
    const q = CONFIG.questions.pred;
    $("pred-instruction").textContent = q.instruction;

    const wrap = $("pred-items");
    q.items.forEach((item) => {
      const block = document.createElement("div");
      block.className = "pred-item";

      const text = document.createElement("p");
      text.className = "pred-qtext";
      text.textContent = item.text;
      block.appendChild(text);

      const likert = document.createElement("div");
      likert.className = "likert";
      likert.id = item.key + "-likert";
      for (let v = 1; v <= 7; v++) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = v;
        b.addEventListener("click", () => {
          draft[item.key] = v;
          renderPred();
        });
        likert.appendChild(b);
      }
      block.appendChild(likert);

      const ends = document.createElement("div");
      ends.className = "likert-ends";
      const minEl = document.createElement("span");
      minEl.textContent = q.minLabel;
      const maxEl = document.createElement("span");
      maxEl.textContent = q.maxLabel;
      ends.appendChild(minEl);
      ends.appendChild(maxEl);
      block.appendChild(ends);

      wrap.appendChild(block);
    });

    $("pred-next").addEventListener("click", () => {
      if (PRED_KEYS.some((k) => draft[k] == null)) return;
      if (fromConfirm) {
        fromConfirm = false;
        showConfirm();
      } else {
        renderRsme();
        show("screen-rsme");
      }
    });
  }

  function renderPred() {
    PRED_KEYS.forEach((k) => {
      $(k + "-likert").querySelectorAll("button").forEach((b) => {
        b.classList.toggle("selected", Number(b.textContent) === draft[k]);
      });
    });
    $("pred-next").disabled = PRED_KEYS.some((k) => draft[k] == null);
  }

  // ---------- RSME（縦型スライダー） ----------
  function initRsme() {
    const q = CONFIG.questions.rsme;
    $("rsme-text").textContent = q.text;

    const numbers = $("rsme-numbers");
    const track = $("rsme-track");
    const anchors = $("rsme-anchors");
    const pct = (v) => ((v - q.min) / (q.max - q.min)) * 100;

    // 目盛と数値（10刻み、50刻みは長め）
    for (let v = q.min; v <= q.max; v += q.tickStep) {
      const tick = document.createElement("div");
      tick.className = "rsme-tick" + (v % q.majorTickStep === 0 ? " major" : "");
      tick.style.bottom = pct(v) + "%";
      track.appendChild(tick);

      const num = document.createElement("div");
      num.className = "rsme-num";
      num.textContent = v;
      num.style.bottom = pct(v) + "%";
      numbers.appendChild(num);
    }

    // アンカーラベル（config.js の RSME_ANCHORS）
    q.anchors.forEach((a) => {
      const el = document.createElement("div");
      el.className = "rsme-anchor";
      el.textContent = a.label;
      el.style.bottom = pct(a.value) + "%";
      anchors.appendChild(el);
    });

    // タッチ／ドラッグで値を設定
    const scale = $("rsme-scale");
    let dragging = false;
    const setFromPointer = (e) => {
      const rect = track.getBoundingClientRect();
      let value = ((rect.bottom - e.clientY) / rect.height) * (q.max - q.min) + q.min;
      value = Math.round(Math.max(q.min, Math.min(q.max, value)));
      draft.rsme = value;
      renderRsme();
    };
    scale.addEventListener("pointerdown", (e) => {
      dragging = true;
      scale.setPointerCapture(e.pointerId);
      setFromPointer(e);
      e.preventDefault();
    });
    scale.addEventListener("pointermove", (e) => {
      if (dragging) setFromPointer(e);
    });
    const stop = () => { dragging = false; };
    scale.addEventListener("pointerup", stop);
    scale.addEventListener("pointercancel", stop);

    $("rsme-next").addEventListener("click", () => {
      if (draft.rsme == null) return;
      fromConfirm = false;
      showConfirm();
    });
  }

  function renderRsme() {
    const q = CONFIG.questions.rsme;
    const handle = $("rsme-handle");
    if (draft.rsme == null) {
      // 初期状態：未回答（印は非表示・決定不可）
      $("rsme-value").textContent = "未回答";
      handle.classList.add("hidden");
      $("rsme-next").disabled = true;
    } else {
      $("rsme-value").textContent = draft.rsme;
      handle.style.bottom = ((draft.rsme - q.min) / (q.max - q.min)) * 100 + "%";
      handle.classList.remove("hidden");
      $("rsme-next").disabled = false;
    }
  }

  // ---------- 確認画面 ----------
  function showConfirm() {
    const list = $("confirm-list");
    list.innerHTML = "";
    const items = [
      { key: "joa", label: CONFIG.questions.joa.shortLabel, screen: "screen-joa" },
      { key: "perf", label: CONFIG.questions.perf.shortLabel, screen: "screen-perf" }
    ];
    if (predEnabled()) {
      CONFIG.questions.pred.items.forEach((it) => {
        items.push({ key: it.key, label: it.shortLabel, screen: "screen-pred" });
      });
    }
    items.push({ key: "rsme", label: CONFIG.questions.rsme.shortLabel, screen: "screen-rsme" });
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "confirm-row";

      const label = document.createElement("div");
      label.className = "c-label";
      label.textContent = it.label;

      const value = document.createElement("div");
      value.className = "c-value";
      value.textContent = draft[it.key];

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "c-edit";
      edit.textContent = "修正";
      edit.addEventListener("click", () => {
        fromConfirm = true; // 修正後は確認画面に戻る（他の回答は保持）
        if (it.key === "rsme") renderRsme();
        else if (it.screen === "screen-pred") renderPred();
        else renderLikert(it.key);
        show(it.screen);
      });

      row.appendChild(label);
      row.appendChild(value);
      row.appendChild(edit);
      list.appendChild(row);
    });
    show("screen-confirm");
  }

  // ---------- 保存（回答を確定） ----------
  function confirmSave() {
    if (draft.joa == null || draft.perf == null || draft.rsme == null ||
        (predEnabled() && PRED_KEYS.some((k) => draft[k] == null))) return;

    const records = loadRecords();
    const idx = records.findIndex(
      (r) => r.participant === session.participant && r.run === session.currentRun
    );
    if (idx >= 0) {
      const ok = window.confirm(
        session.participant + " の走行" + session.currentRun +
        " の記録が既に存在します。\n上書きしますか？（元の記録は削除されます）"
      );
      if (!ok) return;
      records.splice(idx, 1);
    }

    records.push({
      timestamp: localISOString(),
      participant: session.participant,
      condition: session.condition,
      run: session.currentRun,
      joa: draft.joa,
      perf: draft.perf,
      pred1: draft.pred1,
      pred2: draft.pred2,
      pred3: draft.pred3,
      rsme: draft.rsme,
      app_version: CONFIG.appVersion,
      exported: false
    });
    saveRecords(records); // 確定のたびに即時保存

    const savedRun = session.currentRun;
    session.currentRun += 1;
    saveSession();

    toast(CONFIG.messages.saved);
    if (savedRun >= session.plannedRuns) {
      showComplete();
    } else {
      showWait();
    }
  }

  // ---------- 待機・完了 ----------
  function showWait() {
    $("wait-msg").textContent = CONFIG.messages.wait;
    $("wait-progress").textContent = progressText();
    show("screen-wait");
  }

  function showComplete() {
    $("complete-msg").textContent = CONFIG.messages.complete;
    $("complete-progress").textContent = progressText();
    show("screen-complete");
  }

  function nextRun() {
    // 予定走行数を超える追加走行にも対応（通常フローを継続）
    startRunFlow();
  }

  // ============================================================
  // 実験者パネル
  // ============================================================
  function initPanelTrigger() {
    const trigger = $("panel-trigger");
    let timer = null;
    trigger.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      timer = setTimeout(openPanel, CONFIG.panelLongPressMs);
    });
    const cancel = () => { clearTimeout(timer); };
    trigger.addEventListener("pointerup", cancel);
    trigger.addEventListener("pointercancel", cancel);
    trigger.addEventListener("pointerleave", cancel);
  }

  function openPanel() {
    renderPanel();
    $("panel").classList.remove("hidden");
  }
  function closePanel() {
    $("panel").classList.add("hidden");
  }

  function renderPanel() {
    const records = loadRecords();
    const unexported = records.filter((r) => !r.exported).length;

    $("panel-status").textContent =
      "記録件数：" + records.length + "件（未書き出し " + unexported + "件） ｜ " +
      (session
        ? "セッション中：" + session.participant + "・条件" + session.condition +
          "・次は走行" + session.currentRun
        : "セッションなし") +
      " ｜ v" + CONFIG.appVersion;

    // 記録一覧
    const tbody = $("panel-tbody");
    tbody.innerHTML = "";
    records.forEach((r) => {
      const tr = document.createElement("tr");
      // 旧バージョンのレコード（pred列なし）は空欄で表示
      [r.participant, r.condition, r.run, r.joa, r.perf,
       r.pred1 == null ? "" : r.pred1,
       r.pred2 == null ? "" : r.pred2,
       r.pred3 == null ? "" : r.pred3,
       r.rsme, r.timestamp,
       r.exported ? "✓" : "—"].forEach((v) => {
        const td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    // ボタンの有効/無効
    $("btn-del-last").disabled = records.length === 0;
    $("btn-export-all").disabled = records.length === 0;
    $("btn-export-participant").disabled =
      !session || !records.some((r) => r.participant === session.participant);

    // 消去は「未書き出しが0件」のときのみ可能（安全機構）
    const wipeBtn = $("btn-wipe");
    const wipeNote = $("wipe-note");
    if (records.length === 0) {
      wipeBtn.disabled = true;
      wipeNote.classList.add("hidden");
    } else if (unexported > 0) {
      wipeBtn.disabled = true;
      wipeNote.textContent =
        "未書き出しのレコードが" + unexported + "件あるため消去できません。先にCSVを書き出してください。";
      wipeNote.classList.remove("hidden");
    } else {
      wipeBtn.disabled = false;
      wipeNote.classList.add("hidden");
    }
  }

  function deleteLastRecord() {
    const records = loadRecords();
    if (records.length === 0) return;
    const last = records[records.length - 1];
    const ok = window.confirm(
      "直前のレコードを削除します。\n" +
      last.participant + "・走行" + last.run +
      "（joa=" + last.joa + ", perf=" + last.perf +
      ", pred=" + [last.pred1, last.pred2, last.pred3].map((v) => (v == null ? "-" : v)).join("/") +
      ", rsme=" + last.rsme + "）\nよろしいですか？"
    );
    if (!ok) return;
    records.pop();
    saveRecords(records);
    renderPanel();
  }

  // ---------- CSV書き出し ----------
  function csvEscape(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function yyyymmdd(d) {
    d = d || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  function exportCSV(filterParticipant) {
    const records = loadRecords();
    const targets = filterParticipant
      ? records.filter((r) => r.participant === filterParticipant)
      : records;
    if (targets.length === 0) {
      window.alert("書き出す対象のレコードがありません。");
      return;
    }

    const header = "timestamp,participant,condition,run,joa,perf,pred1,pred2,pred3,rsme,app_version";
    const lines = targets.map((r) =>
      [r.timestamp, r.participant, r.condition, r.run, r.joa, r.perf,
       r.pred1 == null ? "" : r.pred1,
       r.pred2 == null ? "" : r.pred2,
       r.pred3 == null ? "" : r.pred3,
       r.rsme, r.app_version]
        .map(csvEscape).join(",")
    );
    // BOM付きUTF-8（Excelでの文字化け防止）
    const blob = new Blob(["\uFEFF" + header + "\n" + lines.join("\n") + "\n"], {
      type: "text/csv;charset=utf-8"
    });

    const name = "survey_" + (filterParticipant || "all") + "_" + yyyymmdd() + ".csv";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    // 書き出し対象に exported フラグを立てる
    targets.forEach((r) => { r.exported = true; });
    saveRecords(records);
    renderPanel();
    toast("CSVを書き出しました：" + name);
  }

  function wipeExported() {
    const records = loadRecords();
    if (records.length === 0 || records.some((r) => !r.exported)) return; // 安全機構
    const ok = window.confirm(
      "書き出し済みレコード " + records.length + "件 をすべて消去します。\n" +
      "CSVファイルの保存（ファイルApp／USBへのコピー）を確認しましたか？\nこの操作は取り消せません。"
    );
    if (!ok) return;
    saveRecords([]);
    renderPanel();
    toast("ローカルデータを消去しました");
  }

  function endSession() {
    const ok = window.confirm("セッションを終了してセットアップ画面に戻りますか？");
    if (!ok) return;
    session = null;
    saveSession();
    closePanel();
    // セットアップ画面を初期状態に戻す（条件のロック解除）
    location.reload();
  }

  // ============================================================
  // 初期化
  // ============================================================
  function init() {
    initSetup();
    initLikertScreens();
    initPred();
    initRsme();
    initPanelTrigger();

    $("btn-save").addEventListener("click", confirmSave);
    $("btn-next-run").addEventListener("click", nextRun);
    $("btn-extra-run").addEventListener("click", nextRun);
    $("btn-open-panel").addEventListener("click", openPanel);

    $("btn-close-panel").addEventListener("click", closePanel);
    $("btn-del-last").addEventListener("click", deleteLastRecord);
    $("btn-export-all").addEventListener("click", () => exportCSV(null));
    $("btn-export-participant").addEventListener("click", () => {
      if (session) exportCSV(session.participant);
    });
    $("btn-wipe").addEventListener("click", wipeExported);
    $("btn-end-session").addEventListener("click", endSession);

    // 未書き出しデータがある場合の離脱警告
    window.addEventListener("beforeunload", (e) => {
      if (unexportedCount() > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    show("screen-setup");

    // service worker 登録（自アセットのキャッシュのみ。外部通信なし）
    if ("serviceWorker" in navigator &&
        (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
