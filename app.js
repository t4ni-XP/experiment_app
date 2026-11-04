/* ============================================================
   走行後主観評価アプリ — ロジック
   ・回答データは localStorage のみに保存（ネットワーク送信なし）
   ・質問文・アンカーは config.js から読む（ここにハードコードしない)
   ============================================================ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------- 状態 ----------
  // {experiment, participant, condition(manual), order(schedule), plannedRuns, currentRun}
  let session = null;
  const PRED_KEYS = CONFIG.questions.pred.items.map((it) => it.key);
  const LIKERT_KEYS = CONFIG.likertKeys;
  const EXP_KEYS = Object.keys(CONFIG.experiments);

  // ---------- 実験・条件 ----------
  // 実験の識別子（v2.0.0 より前の記録・セッションには無いので実験1とみなす）
  function expKeyOf(obj) {
    return (obj && obj.experiment) || "exp1";
  }
  function expOf(obj) {
    return CONFIG.experiments[expKeyOf(obj)];
  }
  // 質問の定義（実験ごとの上書きを反映）
  function question(key) {
    const over = (session && expOf(session).questions && expOf(session).questions[key]) || {};
    return Object.assign({}, CONFIG.questions[key], over);
  }
  // 記録・CSV に出す回答の列（flow の順。pred は3項目に展開）
  function answerKeys(expKey) {
    const keys = [];
    CONFIG.experiments[expKey].flow.forEach((step) => {
      if (step === "pred") PRED_KEYS.forEach((k) => keys.push(k));
      else keys.push(step);
    });
    return keys;
  }
  // 実験の回答列の和集合（パネル表示・全件CSV用）。列順は実験によらず固定
  function allAnswerKeys(expKeys) {
    const used = [];
    (expKeys || EXP_KEYS).forEach((e) => { used.push.apply(used, answerKeys(e)); });
    return LIKERT_KEYS.concat(PRED_KEYS, ["rsme"]).filter((k) => used.indexOf(k) !== -1);
  }
  function findOrder(exp, orderKey) {
    return (exp.orders || []).find((o) => o.key === orderKey) || null;
  }
  function scheduledRuns(exp) {
    return exp.orders[0].conditions.length * exp.runsPerCondition;
  }
  // 走行番号から条件を決める（schedule は予定外の走行なら null）
  function conditionForRun(sess, run) {
    const exp = expOf(sess);
    if (exp.conditionMode !== "schedule") return sess.condition;
    const order = findOrder(exp, sess.order);
    if (!order) return null;
    return order.conditions[Math.floor((run - 1) / exp.runsPerCondition)] || null;
  }
  function currentCondition() {
    return session ? conditionForRun(session, session.currentRun) : null;
  }
  // 現在の条件で予測可能性画面を出すか（skipConditions の条件では出さない）
  function predEnabled() {
    return !!session && CONFIG.questions.pred.skipConditions.indexOf(currentCondition()) === -1;
  }
  function sessionLabel(sess) {
    const exp = expOf(sess);
    const cond = exp.conditionMode === "schedule"
      ? "順序" + (findOrder(exp, sess.order) || { label: "?" }).label
      : "条件" + sess.condition;
    return exp.label + "・" + sess.participant + "・" + cond;
  }
  function sameRun(r, expKey, participant, run) {
    return expKeyOf(r) === expKey && r.participant === participant && r.run === run;
  }

  function emptyDraft() {
    const d = { rsme: null };
    LIKERT_KEYS.forEach((k) => { d[k] = null; });
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
  function answeredRuns() {
    const runs = new Set();
    loadRecords().forEach((r) => {
      if (expKeyOf(r) === expKeyOf(session) && r.participant === session.participant) runs.add(r.run);
    });
    return runs.size;
  }

  function progressText() {
    return (
      session.participant + " ｜ " +
      answeredRuns() + "/" + session.plannedRuns + "走行 回答済み"
    );
  }

  // ============================================================
  // セットアップ画面
  // ============================================================
  let setupExperiment = null;
  let setupCondition = null;
  let setupOrder = null;

  // セグメントボタンを作る（items: [{value, label}]）
  function buildSeg(group, items, onSelect) {
    group.innerHTML = "";
    items.forEach((it) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      b.dataset.value = it.value;
      b.addEventListener("click", () => onSelect(it.value));
      group.appendChild(b);
    });
  }
  function markSeg(group, value) {
    group.querySelectorAll("button").forEach((x) => {
      x.classList.toggle("selected", x.dataset.value === value);
    });
  }

  function orderDescription(exp, order) {
    if (!order) return "";
    const parts = [];
    order.conditions.forEach((c, i) => {
      const from = i * exp.runsPerCondition + 1;
      const to = from + exp.runsPerCondition - 1;
      parts.push("走行" + (from === to ? from : from + "〜" + to) + "：条件" + c);
    });
    return parts.join(" ／ ");
  }

  // 実験を切り替える（条件 or 順序の欄と予定走行数を合わせる）
  function selectExperiment(expKey) {
    setupExperiment = expKey;
    markSeg($("experiment-group"), expKey);
    const exp = CONFIG.experiments[expKey];
    $("experiment-desc").textContent = exp.description || "";
    const scheduled = exp.conditionMode === "schedule";
    $("field-condition").classList.toggle("hidden", scheduled);
    $("field-order").classList.toggle("hidden", !scheduled);
    if (scheduled) {
      buildSeg($("order-group"),
        exp.orders.map((o) => ({ value: o.key, label: o.label })), selectOrder);
      selectOrder(findOrder(exp, setupOrder) ? setupOrder : null);
      $("inp-planned").value = scheduledRuns(exp);
      $("inp-planned").disabled = true; // 順序から決まる
    } else {
      $("inp-planned").value = exp.defaultPlannedRuns;
      $("inp-planned").disabled = false;
    }
  }

  function selectOrder(orderKey) {
    setupOrder = orderKey;
    markSeg($("order-group"), orderKey);
    const exp = CONFIG.experiments[setupExperiment];
    $("order-desc").textContent = orderDescription(exp, findOrder(exp, orderKey));
  }

  function selectCondition(c) {
    setupCondition = c;
    markSeg($("condition-group"), c);
  }

  function initSetup() {
    buildSeg($("experiment-group"),
      EXP_KEYS.map((k) => ({ value: k, label: CONFIG.experiments[k].label })), selectExperiment);
    buildSeg($("condition-group"),
      CONFIG.conditions.map((c) => ({ value: c, label: c })), selectCondition);

    // 前回セッションの復元（Safari再起動などで中断した場合の再開用）
    const prev = loadSession();
    if (prev) {
      setupOrder = prev.order || null;
      selectExperiment(expKeyOf(prev));
      if (prev.condition) selectCondition(prev.condition);
      $("inp-participant").value = prev.participant;
      $("inp-startrun").value = prev.currentRun;
      $("inp-planned").value = prev.plannedRuns;
      const nextCond = conditionForRun(prev, prev.currentRun);
      const note = $("setup-resume-note");
      note.textContent =
        "前回のセッションを検出しました（" + sessionLabel(prev) + "・次は走行" + prev.currentRun +
        (nextCond ? "（条件" + nextCond + "）" : "") + "）。内容を確認して再開してください。";
      note.classList.remove("hidden");
    } else {
      selectExperiment(CONFIG.defaultExperiment);
    }

    $("btn-start").addEventListener("click", startSession);
  }

  function startSession() {
    const err = $("setup-error");
    err.classList.add("hidden");

    const exp = CONFIG.experiments[setupExperiment];
    const scheduled = exp.conditionMode === "schedule";
    const participant = $("inp-participant").value.trim();
    const startRun = parseInt($("inp-startrun").value, 10);
    const planned = scheduled ? scheduledRuns(exp) : parseInt($("inp-planned").value, 10);

    if (!participant) return showSetupError("参加者IDを入力してください。");
    if (!scheduled && !setupCondition) return showSetupError("条件を選択してください。");
    if (scheduled && !findOrder(exp, setupOrder)) return showSetupError("条件の順序を選択してください。");
    if (!(startRun >= 1)) return showSetupError("開始走行番号は1以上で入力してください。");
    if (scheduled && startRun > planned) {
      return showSetupError("開始走行番号は" + planned + "以下で入力してください（" + exp.label + "は全" + planned + "走行）。");
    }
    if (!(planned >= 1)) return showSetupError("予定走行数は1以上で入力してください。");

    // 二重記録の警告（同一 実験×参加者ID×走行番号 が既に存在する場合）
    const exists = loadRecords().some((r) => sameRun(r, setupExperiment, participant, startRun));
    if (exists) {
      const ok = window.confirm(
        "警告：" + exp.label + " " + participant + " の走行" + startRun +
        " の記録が既に存在します。\nこのまま進むと、回答確定時に上書きの確認が表示されます。\n続行しますか？"
      );
      if (!ok) return;
    }

    // 実験・条件（順序）はセッション中ロック（セットアップに戻るまで変更不可）
    session = {
      experiment: setupExperiment,
      participant: participant,
      plannedRuns: planned,
      currentRun: startRun
    };
    if (scheduled) session.order = setupOrder;
    else session.condition = setupCondition;
    saveSession();
    startRunFlow();
  }

  function showSetupError(msg) {
    const err = $("setup-error");
    err.textContent = msg;
    err.classList.remove("hidden");
  }

  // ============================================================
  // 参加者回答フロー（実験の flow の順 → 確認）
  // ※予測可能性は skipConditions の条件（例：C）ではスキップ
  // ============================================================
  function stepEnabled(step) {
    return step !== "pred" || predEnabled();
  }

  function openStep(step) {
    if (step === "pred") renderPred();
    else if (step === "rsme") renderRsme();
    else {
      const q = question(step); // 実験ごとの文言を反映
      $(step + "-text").textContent = q.text;
      $(step + "-min").textContent = q.minLabel;
      $(step + "-max").textContent = q.maxLabel;
      renderLikert(step);
    }
    show("screen-" + step);
  }

  // step の次の画面へ（確認画面の「修正」から来たときは確認画面へ戻る）
  function goNext(step) {
    if (fromConfirm) {
      fromConfirm = false;
      showConfirm();
      return;
    }
    const flow = expOf(session).flow;
    for (let i = flow.indexOf(step) + 1; i < flow.length; i++) {
      if (stepEnabled(flow[i])) return openStep(flow[i]);
    }
    showConfirm();
  }

  function startRunFlow() {
    draft = emptyDraft();
    fromConfirm = false;
    openStep(expOf(session).flow.filter(stepEnabled)[0]);
  }

  // ---------- 1問1画面のリッカート（likertKeys 共通） ----------
  function buildLikertScreen(key) {
    const sec = document.createElement("section");
    sec.id = "screen-" + key;
    sec.className = "screen q-screen";
    sec.innerHTML =
      '<p class="qtext" id="' + key + '-text"></p>' +
      '<div class="likert-wrap">' +
      '<div class="likert" id="' + key + '-likert"></div>' +
      '<div class="likert-ends"><span id="' + key + '-min"></span><span id="' + key + '-max"></span></div>' +
      '</div>' +
      '<div class="nav"><button id="' + key + '-next" class="btn primary" disabled>次へ</button></div>';
    return sec;
  }

  function initLikertScreens() {
    const holder = $("likert-screens");
    LIKERT_KEYS.forEach((key) => {
      holder.parentNode.insertBefore(buildLikertScreen(key), holder);
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
        goNext(key);
      });
    });
    holder.remove();
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
      goNext("pred");
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
      goNext("rsme");
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
    const items = [];
    expOf(session).flow.filter(stepEnabled).forEach((step) => {
      if (step === "pred") {
        CONFIG.questions.pred.items.forEach((it) => {
          items.push({ key: it.key, label: it.shortLabel, step: "pred" });
        });
      } else {
        items.push({ key: step, label: question(step).shortLabel, step: step });
      }
    });
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
        openStep(it.step);
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
    const expKey = expKeyOf(session);
    const keys = answerKeys(expKey).filter((k) => predEnabled() || PRED_KEYS.indexOf(k) === -1);
    if (keys.some((k) => draft[k] == null)) return;
    const condition = currentCondition();
    if (!condition) return; // 予定外の走行（schedule）。ボタンを出さないので通常は来ない

    const records = loadRecords();
    const idx = records.findIndex(
      (r) => sameRun(r, expKey, session.participant, session.currentRun)
    );
    if (idx >= 0) {
      const ok = window.confirm(
        expOf(session).label + " " + session.participant + " の走行" + session.currentRun +
        " の記録が既に存在します。\n上書きしますか？（元の記録は削除されます）"
      );
      if (!ok) return;
      records.splice(idx, 1);
    }

    const rec = {
      timestamp: localISOString(),
      experiment: expKey,
      participant: session.participant,
      condition: condition,
      run: session.currentRun
    };
    answerKeys(expKey).forEach((k) => { rec[k] = draft[k]; });
    rec.app_version = CONFIG.appVersion;
    rec.exported = false;
    records.push(rec);
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
    // 順序で条件が決まる実験は、予定を超える走行の条件が無いので追加走行を出さない
    $("btn-extra-run").classList.toggle("hidden", !currentCondition());
    show("screen-complete");
  }

  function nextRun() {
    // 予定走行数を超える追加走行にも対応（通常フローを継続。条件が決まらないときは不可）
    if (!currentCondition()) return;
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
        ? "セッション中：" + sessionLabel(session) + "・次は走行" + session.currentRun +
          (currentCondition() ? "（条件" + currentCondition() + "）" : "（予定の走行は終了）")
        : "セッションなし") +
      " ｜ v" + CONFIG.appVersion;

    // 記録一覧（見出しは回答列から作る）
    const headRow = $("panel-thead-row");
    headRow.innerHTML = "";
    ["exp", "participant", "cond", "run"].concat(allAnswerKeys(), ["timestamp", "書出"]).forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      headRow.appendChild(th);
    });
    const tbody = $("panel-tbody");
    tbody.innerHTML = "";
    records.forEach((r) => {
      const tr = document.createElement("tr");
      // 旧バージョンのレコード（cause / neg / pred 列なし）や C 条件の pred は空欄で表示
      [CONFIG.experiments[expKeyOf(r)] ? CONFIG.experiments[expKeyOf(r)].label : expKeyOf(r),
       r.participant, r.condition, r.run]
        .concat(allAnswerKeys().map((k) => blankIfNull(r[k])))
        .concat([r.timestamp, r.exported ? "✓" : "—"]).forEach((v) => {
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
      !session || !records.some((r) => isSessionParticipant(r));

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
      expOf(last).label + "・" + last.participant + "・走行" + last.run +
      "（" + answerKeys(expKeyOf(last)).map((k) => k + "=" + (last[k] == null ? "-" : last[k])).join(", ") +
      "）\nよろしいですか？"
    );
    if (!ok) return;
    records.pop();
    saveRecords(records);
    renderPanel();
  }

  function blankIfNull(v) {
    return v == null ? "" : v;
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

  function isSessionParticipant(r) {
    return !!session && expKeyOf(r) === expKeyOf(session) && r.participant === session.participant;
  }

  // onlySession=true：セッション中の実験×参加者のみ。false：全件
  // 列は実験の回答列（実験1は v1.x と同じ列）。全件で実験が混在するときは experiment 列を足し、回答列は和集合
  function exportCSV(onlySession) {
    const records = loadRecords();
    const targets = onlySession ? records.filter(isSessionParticipant) : records;
    if (targets.length === 0) {
      window.alert("書き出す対象のレコードがありません。");
      return;
    }

    const exps = [];
    targets.forEach((r) => { if (exps.indexOf(expKeyOf(r)) === -1) exps.push(expKeyOf(r)); });
    const mixed = exps.length > 1;
    const keys = allAnswerKeys(exps);
    const head = mixed ? ["timestamp", "experiment", "participant", "condition", "run"]
                       : ["timestamp", "participant", "condition", "run"];
    const header = head.concat(keys, ["app_version"]).join(",");
    const lines = targets.map((r) =>
      (mixed ? [r.timestamp, expKeyOf(r), r.participant, r.condition, r.run]
             : [r.timestamp, r.participant, r.condition, r.run])
        .concat(keys.map((k) => blankIfNull(r[k])), [r.app_version])
        .map(csvEscape).join(",")
    );
    // BOM付きUTF-8（Excelでの文字化け防止）
    const blob = new Blob(["\uFEFF" + header + "\n" + lines.join("\n") + "\n"], {
      type: "text/csv;charset=utf-8"
    });

    const prefix = mixed ? "" : CONFIG.experiments[exps[0]].csvFile;
    const name = "survey_" + prefix + (onlySession ? session.participant : "all") + "_" + yyyymmdd() + ".csv";
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
    $("btn-export-all").addEventListener("click", () => exportCSV(false));
    $("btn-export-participant").addEventListener("click", () => {
      if (session) exportCSV(true);
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
    // localhost（npm run dev）では登録しない。キャッシュ優先なので、編集が画面に反映されなくなるため。
    // オフライン動作を手元で確かめたいときは URL に ?sw=1 を付ける
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const wantSW = location.protocol === "https:" || (isLocal && /[?&]sw=1/.test(location.search));
    if ("serviceWorker" in navigator) {
      if (wantSW) {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      } else if (isLocal) {
        navigator.serviceWorker.getRegistrations()
          .then((regs) => regs.forEach((r) => r.unregister()))
          .catch(() => {});
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
