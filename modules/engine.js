/**
 * ==========================================================================
 * GRAMMAR MASTERY v2.0 - CORE TRAINER ENGINE (/modules/engine.js)
 * ==========================================================================
 * Dynamisches Laden des gewählten Themas via fetch(), Rendern des zentrierten
 * Startscreens sowie der beiden Übungsmodi:
 * - 'single_sentence' (Fokussierte Einzelsatz-Ansicht)
 * - 'cloze_text' (Zusammenhängender 100dvh Fließtext-Lückentext)
 * ==========================================================================
 */

import { Gamification } from './gamification.js';
import { UI } from './ui.js';

const DEFAULT_TOPIC_ID = 'word-formation-u1';

export class GrammarEngine {
  constructor() {
    this.topicId = DEFAULT_TOPIC_ID;
    this.topicData = null;
    this.activeExerciseIndex = 0;
    this.activeExercise = null;

    /**
     * Flache Liste aller Lücken der aktuellen Übung:
     * [{ flatIndex, sentenceIndex, sentenceId, gapIndexInSentence, gapData, value, solved, attempts, hintStep }]
     */
    this.gapList = [];
    this.activeGapFlatIndex = 0;
    this.awaitingNextStep = false;
    this.unbindKeyboard = null;
  }

  /**
   * Initialisiert die Engine anhand der URL-Parameter (?topic=...&ex=...).
   */
  async init() {
    const params = new URLSearchParams(window.location.search);
    const bodyDefault =
      (typeof document !== 'undefined' && document.body && document.body.dataset.defaultTopic) ||
      DEFAULT_TOPIC_ID;
    this.topicId = (params.get('topic') || bodyDefault).trim();
    const requestedExId = params.get('ex');

    this.bindStaticControls();
    this.syncHeaderStats(Gamification.getStats());

    Gamification.subscribe((stats, detail) => {
      this.syncHeaderStats(stats);
      if (detail && detail.type === 'badge_unlocked' && detail.badge) {
        UI.showBadgeToast(detail.badge);
      }
    });

    await this.loadTopic(this.topicId, requestedExId);
  }

  /**
   * Bindet Header-, Dock- und Tastatur-Events.
   */
  bindStaticControls() {
    const dockInput = document.getElementById('gm-dock-input');
    const hintBtn = document.getElementById('gm-dock-hint-btn');
    const submitBtn = document.getElementById('gm-dock-submit-btn');
    const rulesToggleBtn = document.getElementById('gm-header-rules-btn');
    const backToStartBtn = document.getElementById('gm-stage-back-btn');
    const muteBtn = document.getElementById('gm-header-mute-btn');

    if (dockInput) {
      dockInput.addEventListener('input', (e) => {
        const currentGap = this.gapList[this.activeGapFlatIndex];
        if (!currentGap || currentGap.solved) return;

        currentGap.value = e.target.value;
        dockInput.classList.remove('is-incorrect');

        const slotEl = this.getGapSlotElement(this.activeGapFlatIndex);
        UI.syncGapSlotDOM({
          gapSlotEl: slotEl,
          value: currentGap.value,
          prompt: currentGap.gapData.prompt || currentGap.gapData.gap,
          state: currentGap.hintStep > 0 ? 'hinted' : 'active'
        });
      });
    }

    if (hintBtn) {
      hintBtn.addEventListener('click', () => {
        this.triggerHint();
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        this.handlePrimaryAction();
      });
    }

    if (rulesToggleBtn) {
      rulesToggleBtn.addEventListener('click', () => {
        this.toggleRulesModal();
      });
    }

    if (backToStartBtn) {
      backToStartBtn.addEventListener('click', () => {
        this.showStartScreen();
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        Gamification.toggleMute();
      });
    }

    if (this.unbindKeyboard) this.unbindKeyboard();
    this.unbindKeyboard = UI.bindKeyboardController({
      onEnter: () => this.handlePrimaryAction(),
      onTabGap: (dir) => this.cycleGap(dir),
      onTriggerHint: () => this.triggerHint(),
      onEscape: () => this.closeRulesModal()
    });
  }

  /**
   * Synchronisiert die Header-Anzeige (XP, Streak, Level, Audio-Status).
   */
  syncHeaderStats(stats) {
    const streakEl = document.getElementById('gm-stat-streak');
    const xpEl = document.getElementById('gm-stat-xp');
    const levelEl = document.getElementById('gm-stat-level');
    const muteBtn = document.getElementById('gm-header-mute-btn');

    if (streakEl) streakEl.textContent = String(stats.streak);
    if (xpEl) xpEl.textContent = String(stats.xp);
    if (levelEl) levelEl.textContent = `Lvl ${stats.level}`;
    if (muteBtn) {
      muteBtn.textContent = stats.muted ? '🔇' : '🔊';
      muteBtn.title = stats.muted ? 'Ton einschalten' : 'Ton stummschalten';
    }
  }

  /**
   * Normalisiert unterschiedliche JSON-Schema-Varianten (sentences vs. items,
   * cloze text/gaps vs. sentences, rules.sections vs. rules.examples), damit alle
   * migrierten Themen und Challenge-JSONs konsistent gerendert werden.
   */
  normalizeTopicData(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const data = { ...raw };

    data.legacyMasteryKey = data.legacyMasteryKey || data.legacyMasteredKey || `grammar_${data.id}_mastered`;
    data.legacyStateKey = data.legacyStateKey || data.legacyStorageKey || `grammar_${data.id}_state`;

    // Rules normalisieren
    const rules = data.rules ? { ...data.rules } : { summary: '', sections: [] };
    if (!Array.isArray(rules.sections) || rules.sections.length === 0) {
      rules.sections = [
        {
          title: rules.title || `${data.title} – Regeln & Struktur`,
          formula: rules.formula || rules.summary || '',
          signalWords: Array.isArray(rules.signalWords) ? rules.signalWords : [],
          examples: Array.isArray(rules.examples) ? rules.examples : []
        }
      ];
    } else {
      rules.sections = rules.sections.map((sec) => ({
        ...sec,
        title: sec.title || sec.heading || `${data.title} – Regeln`,
        formula: sec.formula || sec.Giveaway || rules.summary || '',
        signalWords: Array.isArray(sec.signalWords) ? sec.signalWords : [],
        examples: Array.isArray(sec.examples)
          ? sec.examples
          : Array.isArray(sec.items)
          ? sec.items
          : []
      }));
    }
    data.rules = rules;

    // Falls ein Reading-Comprehension Datensatz vorliegt, normalisiere text, task1_matching, task2_vocabulary & exercises:
    if (data.task1_matching && data.task2_vocabulary) {
      data.type = 'reading-comprehension';
      data.format = 'reading-comprehension';
      data.accentColor = data.accentColor || 'emerald';
      data.icon = data.icon || '📖';

      if (!data.rules || !data.rules.summary) {
        data.rules = {
          title: 'Reading Comprehension Strategy (B2 Exam Prep)',
          summary:
            'Lies zuerst den jeweiligen Abschnitt (`[1]`–`[6]`), auf den die Aufgabe verweist, und prüfe den genauen Satzkontext sowie die geforderte Wortart.',
          sections: [
            {
              title: 'Strategie für Task 1 & Task 2',
              formula: 'Context Scanning · Expression Matching (`A–F` → `0–7`) · Synonym Finding (`1–5`)',
              signalWords: ['[Sec 1]–[Sec 6]', 'Context Clues', 'Part of Speech'],
              examples: [
                '**1. Task 1 (Matching Expressions A–F)**: Öffne über den `[Sec X]`-Button direkt den passenden Textabschnitt und gleiche die Bedeutung im Satzkontext mit den Definitionen `0–7` ab (2 Distraktoren bleiben übrig).',
                '**2. Task 2 (Find a Word or Expression 1–5)**: Achte auf die geforderte Wortart in Klammern (*noun, verb, adjective, gerund*) und übernimm das gesuchte Wort exakt aus dem angegebenen Abschnitt.'
              ]
            }
          ]
        };
      }

      // Normalize text.sections (supports string "[1] ..." or object { id, marker, content })
      if (data.text && Array.isArray(data.text.sections)) {
        data.text = {
          ...data.text,
          sections: data.text.sections.map((sec, idx) => {
            if (typeof sec === 'string') {
              const m = sec.match(/^\[(\d+)\]\s*(.*)$/s);
              const secNum = m ? Number(m[1]) : idx + 1;
              const body = m ? m[2].trim() : sec.trim();
              return {
                id: secNum,
                marker: `[${secNum}]`,
                content: body,
                html: UI.escapeHtml(body)
              };
            }
            return {
              ...sec,
              id: Number(sec.id || idx + 1),
              marker: sec.marker || `[${sec.id || idx + 1}]`,
              content: sec.content || sec.text || ''
            };
          })
        };
      }

      // Normalize task1_matching
      const t1 = { ...data.task1_matching };
      const solMap = t1.solution_mapping || {};
      t1.title = t1.title || 'Task 1: Matching Expressions (A–F with 0–7)';
      const cleanTask1Instruction =
        'Match the expressions (A – F) as used in the text with their corresponding definitions (0 – 7). Be careful: There are two definitions that you do not need.';
      if (
        !t1.instruction ||
        /One definition\s*\(0\)\s*has already been matched correctly\.?/i.test(t1.instruction) ||
        /Write the correct numbers in the grid below\.?/i.test(t1.instruction)
      ) {
        t1.instruction = cleanTask1Instruction;
      }
      t1.expressions = (t1.expressions || []).map((expr) => {
        const eid = expr.id;
        const secNumMatch = String(expr.section || '1').match(/(\d+)/);
        const secNum = secNumMatch ? Number(secNumMatch[1]) : 1;
        const rawText = expr.text || expr.shortLabel || expr.label || '';
        const cleanShort = rawText.replace(/^[A-F]\.\s*/i, '').replace(/\s*\[Sec\s*\d+\]\s*$/i, '').trim();
        const ansNum = expr.answer !== undefined ? Number(expr.answer) : Number(solMap[eid]);
        return {
          ...expr,
          id: eid,
          text: cleanShort,
          shortLabel: `${eid}. ${cleanShort}`,
          label: `${eid}. ${cleanShort} [Sec ${secNum}]`,
          section: secNum,
          answer: ansNum
        };
      });

      t1.definitions = (t1.definitions || []).map((def, dIdx) => {
        const num = def.number !== undefined ? Number(def.number) : Number(def.id ?? dIdx);
        let rawDefText = String(def.text || '').trim();
        let isDistractor = Boolean(def.isDistractor);
        let matchedBy = def.matchedBy || '';

        const parenMatch = rawDefText.match(/\s*\((Do not need|[A-F])\)\s*$/i);
        if (parenMatch) {
          const token = parenMatch[1];
          if (token.toLowerCase() === 'do not need') {
            isDistractor = true;
          } else {
            matchedBy = token.toUpperCase();
          }
          rawDefText = rawDefText.slice(0, parenMatch.index).trim();
        }
        return {
          ...def,
          number: num,
          text: rawDefText,
          isDistractor,
          matchedBy
        };
      });
      data.task1_matching = t1;

      // Normalize task2_vocabulary
      const t2 = { ...data.task2_vocabulary };
      t2.title = t2.title || 'Task 2: Find a Word or Expression';
      t2.items = (t2.items || []).map((item, idx) => {
        const itemId = item.id || idx + 1;
        const secNumMatch = String(item.section || item.context || '1').match(/(\d+)/);
        const secNum = secNumMatch ? Number(secNumMatch[1]) : 1;
        const rawTarget = String(item.target || item.prompt || '')
          .replace(/^\d+\.\s*/, '')
          .replace(/\s*\[Section\s*\d+\]\s*$/i, '')
          .trim();
        const acc =
          Array.isArray(item.acceptedAnswers) && item.acceptedAnswers.length
            ? item.acceptedAnswers
            : [item.answer || ''];
        return {
          ...item,
          id: itemId,
          target: rawTarget,
          context: `[Section ${secNum}]`,
          section: secNum,
          prompt: `${itemId}. ${rawTarget} [Section ${secNum}]`,
          answer: item.answer || acc[0] || '',
          acceptedAnswers: acc
        };
      });
      data.task2_vocabulary = t2;

      const defaultStageInstruction =
        data.instructions ||
        `Read the text '${(data.text && data.text.title) || data.title}' ([1]–[6]) and complete Task 1 (Matching Expressions A–F with 0–7) and Task 2 (Find a Word or Expression 1–5).`;

      if (!Array.isArray(data.exercises) || data.exercises.length === 0) {
        const compatSentences = [
          ...t1.expressions.map((expr) => ({
            id: `t1_${expr.id}`,
            sentence: `${expr.label} → Definition {{0}}`,
            text: `${expr.label} → Definition {{0}}`,
            gaps: [
              {
                id: `match_${expr.id}`,
                prompt: expr.label,
                answer: String(expr.answer),
                acceptedAnswers: [String(expr.answer)],
                solutions: [String(expr.answer)]
              }
            ]
          })),
          ...t2.items.map((item) => ({
            id: `t2_${item.id}`,
            sentence: `${item.prompt}: {{0}}`,
            text: `${item.prompt}: {{0}}`,
            gaps: [
              {
                id: `syn_${item.id}`,
                prompt: item.prompt,
                answer: item.answer,
                acceptedAnswers: item.acceptedAnswers,
                solutions: item.acceptedAnswers
              }
            ]
          }))
        ];
        data.exercises = [
          {
            id: `${data.id}-main`,
            title: `${(data.text && data.text.title) || data.title} – Task 1 & Task 2`,
            type: 'reading_comprehension',
            instruction: defaultStageInstruction,
            sentences: compatSentences
          }
        ];
      } else if (
        data.exercises[0] &&
        /One definition\s*\(0\)\s*has already been matched correctly/i.test(
          data.exercises[0].instruction || ''
        )
      ) {
        data.exercises[0].instruction = defaultStageInstruction;
      }
    }
    // konvertiere `tasks` nahtlos in `exercises`:
    if ((!Array.isArray(data.exercises) || data.exercises.length === 0) && Array.isArray(data.tasks)) {
      const isKw = String(data.id || '').startsWith('key-word');
      data.exercises = data.tasks.map((t, tIdx) => {
        const tId = t.taskId || t.task || tIdx + 1;
        return {
          id: `task-${tId}`,
          title: `Task ${tId}: ${t.level || 'B2 Practice'}`,
          type: isKw ? 'key-word-transformation' : 'word-formation',
          instruction: data.instructions || '',
          sentences: (t.exercises || []).map((ex, sIdx) => {
            if (ex.keyWord || ex.sentence1) {
              const p1 = ex.part1 || '';
              const p2 = ex.part2 || '';
              const kw = String(ex.keyWord || '').toUpperCase();
              const sols = Array.isArray(ex.acceptedAnswers) && ex.acceptedAnswers.length
                ? ex.acceptedAnswers
                : [ex.answer || ''];
              return {
                id: `t${tId}_s${sIdx + 1}`,
                sentence1: ex.sentence1 || '',
                part1: p1,
                part2: p2,
                keyWord: kw,
                text: `${p1} {{0}} ${p2}`.trim(),
                gaps: [
                  {
                    id: 'g1',
                    prompt: kw,
                    keyWord: kw,
                    answer: sols[0] || '',
                    acceptedAnswers: sols,
                    solutions: sols,
                    hint: `Use '${kw}' unmodified (2 to 5 words).`,
                    explanation: `Target transformation: '${sols[0] || ''}'`
                  }
                ]
              };
            }
            const baseWord = String(ex.baseWord || ex.hint || '').toUpperCase();
            const sols = Array.isArray(ex.acceptedAnswers) && ex.acceptedAnswers.length
              ? ex.acceptedAnswers
              : [ex.answer || ''];
            const rawSent = String(ex.sentence || '').replace(/\{gap\}/g, '{{0}}');
            return {
              id: `t${tId}_s${sIdx + 1}`,
              sentence: ex.sentence || rawSent,
              baseWord,
              hint: baseWord,
              text: rawSent,
              gaps: [
                {
                  id: 'g1',
                  prompt: baseWord,
                  baseWord,
                  hint: baseWord,
                  answer: sols[0] || '',
                  acceptedAnswers: sols,
                  solutions: sols,
                  explanation: `Base word: ${baseWord} → ${sols[0] || ''}`
                }
              ]
            };
          })
        };
      });
    }

    // Exercises normalisieren
    data.exercises = (data.exercises || []).map((ex, exIdx) => {
      const normEx = { ...ex };
      if (!normEx.id) normEx.id = `ex${exIdx + 1}`;

      let rawSentences = normEx.sentences || normEx.items || [];

      // Falls cloze_text mit Top-Level text + gaps vorliegt:
      if ((!rawSentences || rawSentences.length === 0) && normEx.text && Array.isArray(normEx.gaps)) {
        rawSentences = [
          {
            id: `${normEx.id}_p1`,
            text: normEx.text,
            gaps: normEx.gaps
          }
        ];
      }

      normEx.sentences = rawSentences.map((s, sIdx) => {
        const textVal = (s.text || s.sentence || '').replace(/\{gap\}/g, '{{0}}');
        const gaps = (s.gaps || []).map((g, gIdx) => {
          const promptVal = g.prompt || g.keyWord || g.baseWord || g.gap || g.stem || '';
          const rawSols =
            g.solutions ||
            g.acceptedAnswers ||
            g.correct ||
            (g.answer ? [g.answer] : g.solution ? [g.solution] : []);
          const cleanSols = (Array.isArray(rawSols) ? rawSols : [String(rawSols)])
            .map((x) => String(x || '').trim())
            .filter(Boolean);
          return {
            ...g,
            id: g.id || `g${gIdx + 1}`,
            gap: g.gap || promptVal,
            prompt: promptVal,
            keyWord: g.keyWord || s.keyWord || '',
            baseWord: g.baseWord || s.baseWord || s.hint || '',
            grammarHint: g.grammarHint || g.hint || '',
            hints: Array.isArray(g.hints)
              ? g.hints
              : g.hint
              ? [g.hint]
              : [],
            answer: cleanSols[0] || '',
            acceptedAnswers: cleanSols,
            solutions: cleanSols,
            explanation: g.explanation || g.fb || ''
          };
        });
        return {
          ...s,
          id: s.id || `s${sIdx + 1}`,
          text: textVal,
          sentence: textVal,
          gaps
        };
      });

      return normEx;
    });

    return data;
  }

  /**
   * Lädt die Themen-JSON-Datei aus /data/topics/<topicId>.json.
   * Falls ein Thema noch nicht als JSON vorliegt, wird der Katalog geprüft.
   */
  async loadTopic(topicId, requestedExId = null) {
    const loadingEl = document.getElementById('gm-loading-state');
    if (loadingEl) loadingEl.hidden = false;

    try {
      let rawData = null;
      try {
        const response = await fetch(`data/topics/${encodeURIComponent(topicId)}.json`, {
          cache: 'no-cache'
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        rawData = await response.json();
      } catch (fetchErr) {
        if (typeof window !== 'undefined' && window.GM_TOPICS && window.GM_TOPICS[topicId]) {
          rawData = window.GM_TOPICS[topicId];
        } else {
          throw fetchErr;
        }
      }

      this.topicData = this.normalizeTopicData(rawData);
      const levelLabel = this.topicData.level || 'B2 / Abschlussklasse';
      document.title = `${this.topicData.title} · ${levelLabel} | Use of English`;

      // Setze Akzentfarbe auf Body für konsistentes Theming
      document.body.dataset.accent = this.topicData.accentColor || 'violet';

      const headerTitle = document.getElementById('gm-header-topic-title');
      const headerGrade = document.getElementById('gm-header-grade-pill');
      if (headerTitle) headerTitle.textContent = this.topicData.title;
      if (headerGrade) headerGrade.textContent = levelLabel;

      if (loadingEl) loadingEl.hidden = true;

      if (requestedExId) {
        const idx = this.topicData.exercises.findIndex((ex) => ex.id === requestedExId);
        if (idx !== -1) {
          this.startExercise(idx);
          return;
        }
      }

      if (this.isReadingComprehensionTopic() && this.topicData.exercises.length === 1) {
        this.startExercise(0);
        return;
      }

      this.showStartScreen();
    } catch (err) {
      if (loadingEl) loadingEl.hidden = true;
      await this.renderFallbackOrError(topicId);
    }
  }

  /**
   * Falls ein Thema nicht gefunden wurde, biete eine saubere Brücke zum Use of English Hub an.
   */
  async renderFallbackOrError(topicId) {
    const startView = document.getElementById('gm-start-screen');
    const stageView = document.getElementById('gm-trainer-stage');
    const dock = document.getElementById('gm-input-dock');

    if (stageView) stageView.hidden = true;
    if (dock) dock.hidden = true;
    if (!startView) return;
    startView.hidden = false;

    let catalogItem = null;
    try {
      const catRes = await fetch('data/topics-catalog.json');
      if (catRes.ok) {
        const catData = await catRes.json();
        catalogItem = (catData.topics || []).find((t) => t.id === topicId);
      }
    } catch {
      // Ignorieren
    }

    if (catalogItem && catalogItem.legacyUrl) {
      startView.innerHTML = `
        <div class="gm-start-card">
          <div class="gm-start-eyebrow">${UI.escapeHtml(catalogItem.level || 'B2 / ABSCHLUSSKLASSE')} · ${UI.escapeHtml(catalogItem.category)}</div>
          <div class="gm-start-icon">${catalogItem.icon || '📘'}</div>
          <h1 class="gm-start-title">${UI.escapeHtml(catalogItem.title)}</h1>
          <p class="gm-start-desc">${UI.escapeHtml(catalogItem.description)}</p>
          <div class="gm-start-cta-row">
            <a href="${UI.escapeHtml(catalogItem.legacyUrl)}" class="gm-btn-primary">
              Training öffnen →
            </a>
            <a href="index.html" class="gm-btn-secondary">
              Zurück zu Use of English
            </a>
          </div>
        </div>
      `;
    } else {
      startView.innerHTML = `
        <div class="gm-start-card">
          <div class="gm-start-eyebrow">THEMA NICHT GEFUNDEN</div>
          <div class="gm-start-icon">🧭</div>
          <h1 class="gm-start-title">Datensatz "${UI.escapeHtml(topicId)}" nicht verfügbar</h1>
          <p class="gm-start-desc">
            Wähle eine Use-of-English-Einheit auf der Startseite oder starte direkt mit Unit 1.
          </p>
          <div class="gm-start-cta-row">
            <a href="exercise.html?topic=word-formation-u1" class="gm-btn-primary">
              Word Formation – Unit 1 starten
            </a>
            <a href="exercise.html?topic=key-word-u1" class="gm-btn-secondary">
              Key-Word Transformation – Unit 1 starten
            </a>
            <a href="index.html" class="gm-btn-secondary">
              Zum Use of English Hub
            </a>
          </div>
        </div>
      `;
    }
  }

  /**
   * Rendert den zentrierten, modernen Startscreen des geladenen Themas.
   */
  showStartScreen() {
    UI.hideFeedbackDrawer();
    const startView = document.getElementById('gm-start-screen');
    const stageView = document.getElementById('gm-trainer-stage');
    const dock = document.getElementById('gm-input-dock');

    if (stageView) stageView.hidden = true;
    if (dock) dock.hidden = true;
    if (!startView || !this.topicData) return;
    startView.hidden = false;

    const progress = Gamification.getTopicProgress(
      this.topicData.id,
      this.topicData.legacyMasteryKey
    );
    const solvedSet = new Set(progress.solvedExercises || []);
    const exercises = this.topicData.exercises || [];

    // Bestimme die nächste noch offene Übung für den Haupt-CTA
    let nextExIndex = exercises.findIndex((ex) => !solvedSet.has(ex.id));
    if (nextExIndex === -1) nextExIndex = 0;

    const rules = this.topicData.rules || { summary: '', sections: [] };

    const rulesHtml = (rules.sections || [])
      .map(
        (sec) => `
        <div class="gm-rule-box">
          <h3 class="gm-rule-box-title">${UI.formatInlineMarkdown(sec.title)}</h3>
          <div class="gm-rule-formula">${UI.formatInlineMarkdown(sec.formula)}</div>
          ${
            sec.signalWords && sec.signalWords.length
              ? `<div class="gm-signal-pills">
                   ${sec.signalWords
                     .map((w) => `<span class="gm-signal-pill">${UI.formatInlineMarkdown(w)}</span>`)
                     .join('')}
                 </div>`
              : ''
          }
          ${
            sec.examples && sec.examples.length
              ? `<ul class="gm-rule-examples">
                   ${sec.examples.map((ex) => `<li>${UI.formatInlineMarkdown(ex)}</li>`).join('')}
                 </ul>`
              : ''
          }
        </div>
      `
      )
      .join('');

    const exercisesHtml = exercises
      .map((ex, idx) => {
        const isDone = solvedSet.has(ex.id);
        const totalGaps = (ex.sentences || []).reduce(
          (acc, s) => acc + (s.gaps ? s.gaps.length : 0),
          0
        );
        const modeLabel =
          ex.type === 'reading_comprehension'
            ? '📖 Reading Comprehension (Task 1 & 2)'
            : ex.type === 'cloze_text'
            ? '📖 Fließtext-Lückentext'
            : '🎯 Einzelsätze';
        const countLabel = ex.type === 'reading_comprehension' ? `${totalGaps} Items` : `${totalGaps} Lücken`;

        return `
          <button
            type="button"
            class="gm-ex-select-card ${isDone ? 'is-solved' : ''}"
            data-ex-index="${idx}"
          >
            <div class="gm-ex-select-left">
              <span class="gm-ex-num-badge">${isDone ? '✓' : idx + 1}</span>
              <div class="gm-ex-select-meta">
                <div class="gm-ex-select-title">${UI.escapeHtml(ex.title)}</div>
                <div class="gm-ex-select-sub">
                  <span>${modeLabel}</span>
                  <span>•</span>
                  <span>${countLabel}</span>
                </div>
              </div>
            </div>
            <div class="gm-ex-select-right">
              <span class="gm-ex-status-pill ${isDone ? 'is-done' : ''}">
                ${isDone ? 'Gelöst ★' : 'Starten →'}
              </span>
            </div>
          </button>
        `;
      })
      .join('');

    startView.innerHTML = `
      <div class="gm-start-card">
        <div class="gm-start-header">
          <div class="gm-start-eyebrow">
            ${UI.escapeHtml(this.topicData.level || 'B2 / ABSCHLUSSKLASSE')} · ${UI.escapeHtml(
              this.topicData.category || 'USE OF ENGLISH'
            )}
          </div>
          <div class="gm-start-icon">${this.topicData.icon || '✨'}</div>
          <h1 class="gm-start-title">${UI.escapeHtml(this.topicData.title)}</h1>
          <p class="gm-start-desc">${UI.escapeHtml(this.topicData.description)}</p>

          <div class="gm-start-cta-row">
            <button type="button" class="gm-btn-primary gm-btn-lg" id="gm-start-primary-btn">
              <span>${
                solvedSet.size > 0 && solvedSet.size < exercises.length
                  ? `Weiter mit Übung ${nextExIndex + 1}`
                  : 'Jetzt Training starten'
              }</span>
              <span aria-hidden="true">→</span>
            </button>
            <a href="index.html" class="gm-btn-secondary">
              ← Alle Themen
            </a>
          </div>
        </div>

        ${
          rules.warning
            ? `<div class="gm-rule-warning">${UI.formatInlineMarkdown(rules.warning)}</div>`
            : ''
        }

        <div class="gm-rules-grid">
          ${rulesHtml}
        </div>

        <div class="gm-ex-list-section">
          <div class="gm-ex-list-header">
            <h2>Übungseinheiten (${solvedSet.size}/${exercises.length} gelöst)</h2>
            ${
              progress.mastered
                ? `<span class="gm-mastered-pill">🏆 Topic Mastered</span>`
                : ''
            }
          </div>
          <div class="gm-ex-select-grid">
            ${exercisesHtml}
          </div>
        </div>
      </div>
    `;

    const primaryBtn = startView.querySelector('#gm-start-primary-btn');
    if (primaryBtn) {
      primaryBtn.onclick = () => this.startExercise(nextExIndex);
    }

    startView.querySelectorAll('.gm-ex-select-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.exIndex || '0', 10);
        this.startExercise(idx);
      });
    });
  }

  isReadingComprehensionTopic() {
    return Boolean(
      this.topicData &&
        (this.topicData.type === 'reading-comprehension' ||
          this.topicData.format === 'reading-comprehension' ||
          (this.topicData.task1_matching && this.topicData.task2_vocabulary))
    );
  }

  isReadingComprehensionExercise() {
    return Boolean(
      this.isReadingComprehensionTopic() ||
        (this.activeExercise && this.activeExercise.type === 'reading_comprehension')
    );
  }

  /**
   * Startet eine spezifische Übungseinheit (Einzelsätze, Lückentext oder Reading Comprehension).
   * @param {number} exerciseIndex
   */
  startExercise(exerciseIndex) {
    if (!this.topicData || !this.topicData.exercises[exerciseIndex]) return;

    this.activeExerciseIndex = exerciseIndex;
    this.activeExercise = this.topicData.exercises[exerciseIndex];
    this.awaitingNextStep = false;
    this.readingAttemptCount = 0;
    this.readingSolutionsVisible = false;
    UI.hideFeedbackDrawer();

    // Erzeuge flache Lücken-Registry für nahtlose Navigation
    this.gapList = [];
    (this.activeExercise.sentences || []).forEach((sentence, sIdx) => {
      (sentence.gaps || []).forEach((gap, gIdx) => {
        this.gapList.push({
          flatIndex: this.gapList.length,
          sentenceIndex: sIdx,
          sentenceId: sentence.id,
          sentenceText: sentence.text,
          gapIndexInSentence: gIdx,
          gapData: gap,
          value: '',
          solved: false,
          attempts: 0,
          hintStep: 0
        });
      });
    });

    this.activeGapFlatIndex = 0;

    // Umschalten auf 100dvh Trainer-Bühne
    const startView = document.getElementById('gm-start-screen');
    const stageView = document.getElementById('gm-trainer-stage');
    const dock = document.getElementById('gm-input-dock');
    const isReading = this.isReadingComprehensionExercise();

    if (startView) startView.hidden = true;
    if (stageView) {
      stageView.hidden = false;
      stageView.classList.toggle('is-reading-stage', isReading);
    }
    if (dock) dock.hidden = isReading;

    this.renderStageHeader();
    this.renderStageContent();
    if (!isReading) {
      this.activateGap(0, true);
    }
  }

  /**
   * Aktualisiert die Kopfzeile der aktiven Übung (Titel, Modus, Fortschrittsbalken).
   */
  renderStageHeader() {
    const titleEl = document.getElementById('gm-stage-ex-title');
    const modeBadgeEl = document.getElementById('gm-stage-mode-badge');
    const instructionEl = document.getElementById('gm-stage-instruction');

    if (titleEl && this.activeExercise) {
      titleEl.textContent = this.isReadingComprehensionExercise()
        ? this.topicData.title || this.activeExercise.title
        : `${this.activeExerciseIndex + 1}. ${this.activeExercise.title}`;
    }

    if (modeBadgeEl && this.activeExercise) {
      modeBadgeEl.textContent = this.isReadingComprehensionExercise()
        ? '📖 Reading Comprehension'
        : this.activeExercise.type === 'cloze_text'
        ? '📖 Lückentext'
        : '🎯 Einzelsätze';
    }

    if (instructionEl && this.activeExercise) {
      instructionEl.innerHTML = UI.formatInlineMarkdown(this.activeExercise.instruction || '');
    }

    this.updateProgressBar();
  }

  /**
   * Berechnet und aktualisiert den Fortschrittsbalken der aktuellen Übung.
   */
  updateProgressBar() {
    const total = this.gapList.length || 1;
    const solvedCount = this.gapList.filter((g) => g.solved).length;
    const percent = Math.round((solvedCount / total) * 100);

    const fillEl = document.getElementById('gm-stage-progress-fill');
    const textEl = document.getElementById('gm-stage-progress-text');

    if (fillEl) fillEl.style.width = `${percent}%`;
    if (textEl) textEl.textContent = `${solvedCount}/${total} (${percent}%)`;
  }

  /**
   * Rendert den Hauptbereich je nach Übungstyp ('reading_comprehension', 'cloze_text', 'single_sentence').
   */
  renderStageContent() {
    const container = document.getElementById('gm-stage-workspace');
    if (!container || !this.activeExercise) return;

    if (this.isReadingComprehensionExercise()) {
      this.renderReadingComprehensionWorkspace(container);
    } else if (this.activeExercise.type === 'cloze_text') {
      this.renderClozeWorkspace(container);
    } else {
      this.renderSingleSentenceWorkspace(container);
    }
  }

  /**
   * MODUS 3: Interaktives B2 Reading Comprehension ('reading_comprehension')
   * - Desktop: Zweigeteiltes Split-Screen-Layout (Lesetext links [1]–[6], Aufgaben rechts).
   * - Mobile (< 1080px): Sticky Segmented Control ([📖 Text lesen] / [✍️ Aufgaben lösen]) ohne Scrollverlust
   *   + kompakter Quick-Reference Bottom-Sheet Drawer bei Klick auf [Sec X]-Buttons.
   */
  renderReadingComprehensionWorkspace(container) {
    const textData = this.topicData.text || { title: 'Reading Passage', sections: [] };
    const sections = textData.sections || [];
    const task1 = this.topicData.task1_matching || {
      title: 'Task 1: Matching Expressions (A-F with 0-7)',
      instruction: '',
      expressions: [],
      definitions: [],
      solution_mapping: {}
    };
    const task2 = this.topicData.task2_vocabulary || {
      title: 'Task 2: Find a Word or Expression',
      instruction: '',
      items: []
    };

    this.readingActiveMobileTab = this.readingActiveMobileTab || 'text';
    this.readingScrollPositions = this.readingScrollPositions || { text: 0, tasks: 0 };
    if (!this.readingUserState || this.readingUserState.topicId !== this.topicData.id) {
      let savedState = null;
      try {
        const rawSaved = sessionStorage.getItem(`gm_reading_state_${this.topicData.id}`);
        if (rawSaved) savedState = JSON.parse(rawSaved);
      } catch (_) {
        // ignore storage errors
      }
      this.readingUserState = savedState || {
        topicId: this.topicData.id,
        task1: {},
        task2: {}
      };
    }
    const persistReadingState = () => {
      try {
        sessionStorage.setItem(
          `gm_reading_state_${this.topicData.id}`,
          JSON.stringify(this.readingUserState)
        );
      } catch (_) {
        // ignore storage errors
      }
    };

    // Map definition number -> text for instant confirmation below each dropdown
    const defTextMap = {};
    (task1.definitions || []).forEach((d) => {
      defTextMap[String(d.number)] = d.text || '';
    });

    const paragraphsHtml = sections
      .map(
        (sec) => `
        <p class="gm-reading-paragraph" id="gm-reading-sec-${sec.id}" data-sec-id="${sec.id}">
          <span class="gm-reading-marker">${UI.escapeHtml(sec.marker || `[${sec.id}]`)}</span>
          ${sec.html ? sec.html : UI.escapeHtml(sec.content || '')}
        </p>
      `
      )
      .join('');

    const chipsHtml = (task1.expressions || [])
      .map(
        (expr) => `
        <button
          type="button"
          class="gm-reading-expr-chip"
          data-jump-sec="${expr.section || 1}"
          data-jump-context="${UI.escapeHtml(expr.label)}"
          title="Abschnitt [${expr.section || 1}] direkt einblenden"
        >
          <span>${UI.escapeHtml(expr.shortLabel || expr.label)}</span>
          <span class="gm-chip-sec-tag">[Sec ${expr.section || 1}]</span>
        </button>
      `
      )
      .join('');

    const defsHtml = (task1.definitions || [])
      .map((def) => {
        const solNote = def.isDistractor
          ? '(Do not need)'
          : def.matchedBy
          ? `(${def.matchedBy})`
          : '';
        return `
          <div class="gm-reading-def-item" data-def-num="${def.number}">
            <span class="gm-reading-def-num">${UI.escapeHtml(String(def.number))}</span>
            <span>
              ${UI.escapeHtml(def.text)}
              <span class="gm-reading-def-note" data-reading-sol-note hidden>${UI.escapeHtml(
                solNote
              )}</span>
            </span>
          </div>
        `;
      })
      .join('');

    const buildOptionsHtml = (selectedVal) =>
      '<option value="">- Wahl -</option>' +
      (task1.definitions || [])
        .map((d) => {
          const valStr = String(d.number);
          const isSelected = selectedVal !== '' && selectedVal !== undefined && String(selectedVal) === valStr;
          const isDisabled = Boolean(d.isExample);
          return `<option value="${valStr}"${isSelected ? ' selected' : ''}${
            isDisabled ? ' disabled' : ''
          }>${valStr}</option>`;
        })
        .join('');

    const matchingRowsHtml = (task1.expressions || [])
      .map((expr) => {
        const savedVal =
          this.readingUserState.task1[expr.id] !== undefined
            ? String(this.readingUserState.task1[expr.id])
            : '';
        const hasPreview = savedVal !== '' && defTextMap[savedVal] !== undefined;
        const previewHtml = hasPreview
          ? `↳ <strong>Definition [${UI.escapeHtml(savedVal)}]:</strong> &ldquo;${UI.escapeHtml(
              defTextMap[savedVal]
            )}&rdquo;`
          : '↳ Wähle eine Nummer (0–7), um die zugehörige Definition hier zu prüfen.';
        return `
        <div class="gm-reading-match-row" data-match-row="${expr.id}">
          <div class="gm-reading-match-top">
            <div class="gm-reading-match-label-wrap">
              <label for="gm-match-${expr.id}" class="gm-reading-match-label">
                ${UI.escapeHtml(expr.shortLabel || expr.label)}
              </label>
              <button
                type="button"
                class="gm-reading-sec-jump"
                data-jump-sec="${expr.section || 1}"
                data-jump-context="${UI.escapeHtml(expr.label)}"
                title="Abschnitt [${expr.section || 1}] als Schnellreferenz öffnen"
              >
                📖 [Sec ${expr.section || 1}]
              </button>
            </div>
            <div class="gm-reading-match-right">
              <select
                id="gm-match-${expr.id}"
                class="gm-reading-select"
                data-expr-id="${expr.id}"
                data-correct="${expr.answer}"
                aria-label="${UI.escapeHtml(expr.label)}"
              >
                ${buildOptionsHtml(savedVal)}
              </select>
              <span
                id="gm-match-sol-${expr.id}"
                class="gm-reading-correct-badge"
                hidden
              >✓ Nr. ${UI.escapeHtml(String(expr.answer))}</span>
            </div>
          </div>
          <div
            id="gm-match-preview-${expr.id}"
            class="gm-reading-selected-def-preview${hasPreview ? '' : ' is-empty'}"
            aria-live="polite"
          >
            ${previewHtml}
          </div>
        </div>
      `;
      })
      .join('');

    const vocabRowsHtml = (task2.items || [])
      .map((item) => {
        const savedVocab =
          this.readingUserState.task2[item.id] !== undefined
            ? String(this.readingUserState.task2[item.id])
            : '';
        return `
        <li class="gm-reading-vocab-row">
          <div class="gm-reading-vocab-label">
            <label for="gm-vocab-${item.id}">
              ${UI.escapeHtml(`${item.id}. ${item.target}:`)}
            </label>
            <button
              type="button"
              class="gm-reading-sec-jump"
              data-jump-sec="${item.section || 1}"
              data-jump-context="${UI.escapeHtml(`${item.id}. ${item.target} ${item.context}`)}"
              title="Abschnitt [${item.section || 1}] als Schnellreferenz öffnen"
            >
              📖 ${UI.escapeHtml(item.context || `[Section ${item.section}]`)}
            </button>
          </div>
          <div class="gm-reading-vocab-input-wrap">
            <input
              type="text"
              id="gm-vocab-${item.id}"
              class="gm-reading-input"
              data-item-id="${item.id}"
              data-answer="${UI.escapeHtml(item.answer)}"
              value="${UI.escapeHtml(savedVocab)}"
              placeholder="Wort / Ausdruck aus ${UI.escapeHtml(item.context)} eingeben …"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              enterkeyhint="done"
            >
            <span
              id="gm-vocab-sol-${item.id}"
              class="gm-reading-correct-badge"
              hidden
            >✓ ${UI.escapeHtml(item.answer)}</span>
          </div>
        </li>
      `;
      })
      .join('');

    const totalItems = (task1.expressions || []).length + (task2.items || []).length;
    const isTasksView = this.readingActiveMobileTab === 'tasks';

    container.innerHTML = `
      <!-- STICKY MOBILE SEGMENTED CONTROL (< 1080px) -->
      <nav class="gm-reading-mobile-tabs" role="tablist" aria-label="Ansicht wechseln (Lesetext oder Aufgaben)">
        <button
          type="button"
          role="tab"
          aria-selected="${isTasksView ? 'false' : 'true'}"
          class="gm-reading-mobile-tab${isTasksView ? '' : ' is-active'}"
          data-reading-tab="text"
        >
          <span>📖 Text lesen</span>
          <span class="gm-reading-tab-pill">[1]–[${sections.length}]</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="${isTasksView ? 'true' : 'false'}"
          class="gm-reading-mobile-tab${isTasksView ? ' is-active' : ''}"
          data-reading-tab="tasks"
        >
          <span>✍️ Aufgaben lösen</span>
          <span class="gm-reading-tab-pill" id="gm-reading-tab-progress">0/${totalItems}</span>
        </button>
      </nav>

      <div class="gm-reading-split-layout" data-mobile-view="${isTasksView ? 'tasks' : 'text'}">
        <!-- LEFT COLUMN: STICKY / SCROLLABLE READING TEXT [1]-[6] -->
        <article class="gm-reading-text-card" id="gm-reading-text-panel" aria-label="Reading Passage">
          <div class="gm-reading-text-header">
            <h2 class="gm-reading-text-title">
              <span>📰</span>
              <span>${UI.escapeHtml(textData.title || 'Memory Games')}</span>
            </h2>
            <span class="gm-reading-text-badge">Sections [1]–[${sections.length}]</span>
          </div>
          <div class="gm-reading-passage-body">
            ${paragraphsHtml}
          </div>
          <div class="gm-reading-mobile-switch-bar">
            <button type="button" class="gm-btn-primary gm-reading-switch-to-tasks-btn">
              <span>✍️ Jetzt Aufgaben lösen (Task 1 &amp; 2)</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </article>

        <!-- RIGHT COLUMN: TASK 1 (MATCHING) & TASK 2 (VOCABULARY) -->
        <div class="gm-reading-tasks-col" id="gm-reading-tasks-panel">
          <!-- TASK 1: MATCHING -->
          <section class="gm-reading-task-card" id="gm-reading-task1">
            <h3 class="gm-reading-task-title">${UI.escapeHtml(task1.title)}</h3>
            <p class="gm-reading-task-instr">${UI.formatInlineMarkdown(task1.instruction)}</p>

            <div class="gm-reading-expr-chips">
              ${chipsHtml}
            </div>

            <div class="gm-reading-defs-grid">
              ${defsHtml}
            </div>

            <div class="gm-reading-matching-box">
              ${matchingRowsHtml}
            </div>
          </section>

          <!-- TASK 2: VOCABULARY / SYNONYMS -->
          <section class="gm-reading-task-card" id="gm-reading-task2">
            <h3 class="gm-reading-task-title">${UI.escapeHtml(task2.title)}</h3>
            <p class="gm-reading-task-instr">${UI.formatInlineMarkdown(task2.instruction)}</p>

            <ul class="gm-reading-vocab-list">
              ${vocabRowsHtml}
            </ul>
          </section>

          <!-- CONTROLS & FEEDBACK -->
          <section class="gm-reading-controls-card">
            <div class="gm-reading-btn-row">
              <button type="button" class="gm-btn-primary gm-btn-lg" id="gm-reading-check-btn">
                <span>Prüfe beide Aufgaben</span>
                <span aria-hidden="true">✓</span>
              </button>
              <button
                type="button"
                class="gm-btn-secondary"
                id="gm-reading-solutions-btn"
                hidden
              >
                Lösungen anzeigen
              </button>
            </div>
            <div id="gm-reading-result-box" class="gm-reading-result-box" hidden></div>
          </section>
        </div>
      </div>

      <!-- QUICK-REFERENCE PARAGRAPH BOTTOM-SHEET / DRAWER -->
      <aside
        id="gm-reading-snippet-drawer"
        class="gm-reading-snippet-drawer"
        aria-label="Textabschnitt-Schnellreferenz"
        hidden
      >
        <div class="gm-reading-snippet-handle" aria-hidden="true"></div>
        <div class="gm-reading-snippet-header">
          <div class="gm-reading-snippet-title-wrap">
            <span class="gm-reading-snippet-badge" id="gm-snippet-sec-badge">Abschnitt [1]</span>
            <span class="gm-reading-snippet-context" id="gm-snippet-context-label">Text-Referenz</span>
          </div>
          <div class="gm-reading-snippet-actions">
            <button type="button" class="gm-snippet-nav-btn" id="gm-snippet-prev-btn" title="Vorheriger Absatz">◀</button>
            <button type="button" class="gm-snippet-nav-btn" id="gm-snippet-next-btn" title="Nächster Absatz">▶</button>
            <button type="button" class="gm-snippet-close-btn" id="gm-snippet-close-btn" aria-label="Schnellreferenz schließen">✕</button>
          </div>
        </div>
        <div class="gm-reading-snippet-body" id="gm-snippet-body"></div>
      </aside>
    `;

    const splitLayout = container.querySelector('.gm-reading-split-layout');
    const stageScroll = document.getElementById('gm-stage-workspace');

    const switchMobileReadingTab = (targetTab) => {
      if (!splitLayout) return;
      const prevTab = splitLayout.getAttribute('data-mobile-view') || 'text';
      if (stageScroll && prevTab !== targetTab) {
        this.readingScrollPositions[prevTab] = stageScroll.scrollTop;
      }
      this.readingActiveMobileTab = targetTab;
      splitLayout.setAttribute('data-mobile-view', targetTab);
      container.querySelectorAll('.gm-reading-mobile-tab').forEach((btn) => {
        const isTarget = btn.getAttribute('data-reading-tab') === targetTab;
        btn.classList.toggle('is-active', isTarget);
        btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      });
      // Stelle sicher, dass alle gewählten Dropdown- & Input-Werte persistent im DOM bleiben
      container.querySelectorAll('.gm-reading-select').forEach((sel) => {
        const exprId = sel.getAttribute('data-expr-id');
        if (exprId && this.readingUserState.task1[exprId] !== undefined) {
          sel.value = String(this.readingUserState.task1[exprId]);
        }
      });
      container.querySelectorAll('.gm-reading-input').forEach((inp) => {
        const itemId = inp.getAttribute('data-item-id');
        if (itemId && this.readingUserState.task2[itemId] !== undefined) {
          inp.value = String(this.readingUserState.task2[itemId]);
        }
      });
      if (stageScroll && prevTab !== targetTab) {
        stageScroll.scrollTop = this.readingScrollPositions[targetTab] || 0;
      }
    };

    container.querySelectorAll('.gm-reading-mobile-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-reading-tab') || 'text';
        switchMobileReadingTab(tab);
      });
    });

    const switchToTasksBtn = container.querySelector('.gm-reading-switch-to-tasks-btn');
    if (switchToTasksBtn) {
      switchToTasksBtn.addEventListener('click', () => {
        switchMobileReadingTab('tasks');
      });
    }

    // Quick-Reference Paragraph Bottom-Sheet Logic
    let activeSnippetSecId = 1;
    const snippetDrawer = container.querySelector('#gm-reading-snippet-drawer');
    const snippetBadge = container.querySelector('#gm-snippet-sec-badge');
    const snippetContext = container.querySelector('#gm-snippet-context-label');
    const snippetBody = container.querySelector('#gm-snippet-body');
    const snippetPrev = container.querySelector('#gm-snippet-prev-btn');
    const snippetNext = container.querySelector('#gm-snippet-next-btn');
    const snippetClose = container.querySelector('#gm-snippet-close-btn');

    const openParagraphSnippet = (secIdNum, contextLabel = '') => {
      const idx = Math.max(1, Math.min(sections.length, Number(secIdNum) || 1));
      activeSnippetSecId = idx;
      const secObj = sections.find((s) => Number(s.id) === idx) || sections[idx - 1];
      if (!secObj) return;

      // Also highlight paragraph in main text column (for desktop split-screen)
      container.querySelectorAll('.gm-reading-paragraph').forEach((p) => {
        p.classList.remove('is-highlighted');
      });
      const targetPara = container.querySelector(`#gm-reading-sec-${idx}`);
      if (targetPara) {
        targetPara.classList.add('is-highlighted');
        if (window.innerWidth >= 1080) {
          targetPara.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      if (snippetDrawer && snippetBody) {
        if (snippetBadge) snippetBadge.textContent = `📖 Abschnitt ${secObj.marker || `[${idx}]`}`;
        if (snippetContext) {
          snippetContext.textContent = contextLabel
            ? `Zu: ${contextLabel}`
            : `${textData.title || 'Memory Games'} · Paragraph ${idx}/${sections.length}`;
        }
        snippetBody.innerHTML = `<p class="gm-snippet-para">${
          secObj.html ? secObj.html : UI.escapeHtml(secObj.content || '')
        }</p>`;
        if (snippetPrev) snippetPrev.disabled = idx <= 1;
        if (snippetNext) snippetNext.disabled = idx >= sections.length;
        snippetDrawer.hidden = false;
      }
    };

    if (snippetPrev) {
      snippetPrev.addEventListener('click', () => {
        if (activeSnippetSecId > 1) openParagraphSnippet(activeSnippetSecId - 1);
      });
    }
    if (snippetNext) {
      snippetNext.addEventListener('click', () => {
        if (activeSnippetSecId < sections.length) openParagraphSnippet(activeSnippetSecId + 1);
      });
    }
    if (snippetClose && snippetDrawer) {
      snippetClose.addEventListener('click', () => {
        snippetDrawer.hidden = true;
      });

      // Touch swipe-down gesture to dismiss bottom-sheet drawer
      let touchStartY = 0;
      snippetDrawer.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches && e.touches.length === 1) {
            touchStartY = e.touches[0].clientY;
          }
        },
        { passive: true }
      );
      snippetDrawer.addEventListener(
        'touchend',
        (e) => {
          if (e.changedTouches && e.changedTouches.length === 1) {
            const deltaY = e.changedTouches[0].clientY - touchStartY;
            if (deltaY > 45) {
              snippetDrawer.hidden = true;
            }
          }
        },
        { passive: true }
      );
    }

    // Bind all [Sec X] / [Section X] jump buttons
    container.querySelectorAll('[data-jump-sec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const secId = btn.getAttribute('data-jump-sec');
        const ctx = btn.getAttribute('data-jump-context') || '';
        openParagraphSnippet(secId, ctx);
      });
    });

    const updateAnsweredCounter = () => {
      let filled = 0;
      container.querySelectorAll('.gm-reading-select').forEach((s) => {
        if (s.value.trim() !== '') filled += 1;
      });
      container.querySelectorAll('.gm-reading-input').forEach((i) => {
        if (i.value.trim() !== '') filled += 1;
      });
      const pill = container.querySelector('#gm-reading-tab-progress');
      if (pill) pill.textContent = `${filled}/${totalItems}`;
    };

    // Dropdown change -> persist selection & show live definition confirmation below row
    container.querySelectorAll('.gm-reading-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        sel.classList.remove('is-incorrect', 'is-correct');
        const exprId = sel.getAttribute('data-expr-id');
        const previewEl = container.querySelector(`#gm-match-preview-${exprId}`);
        const chosenNum = sel.value.trim();
        if (exprId) {
          this.readingUserState.task1[exprId] = chosenNum;
          persistReadingState();
        }
        if (previewEl) {
          if (chosenNum !== '' && defTextMap[chosenNum] !== undefined) {
            previewEl.classList.remove('is-empty');
            previewEl.innerHTML = `↳ <strong>Definition [${UI.escapeHtml(
              chosenNum
            )}]:</strong> &ldquo;${UI.escapeHtml(defTextMap[chosenNum])}&rdquo;`;
          } else {
            previewEl.classList.add('is-empty');
            previewEl.textContent =
              '↳ Wähle eine Nummer (0–7), um die zugehörige Definition hier zu prüfen.';
          }
        }
        updateAnsweredCounter();
      });
    });

    // Input change -> persist input & virtual-keyboard-friendly focus scrolling
    container.querySelectorAll('.gm-reading-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        inp.classList.remove('is-incorrect', 'is-correct');
        const itemId = inp.getAttribute('data-item-id');
        if (itemId) {
          this.readingUserState.task2[itemId] = inp.value;
          persistReadingState();
        }
        updateAnsweredCounter();
      });
      inp.addEventListener('focus', () => {
        setTimeout(() => {
          inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 180);
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.evaluateReadingComprehension(container);
        }
      });
    });

    updateAnsweredCounter();

    const checkBtn = container.querySelector('#gm-reading-check-btn');
    if (checkBtn) {
      checkBtn.addEventListener('click', () => {
        this.evaluateReadingComprehension(container);
      });
    }

    const solBtn = container.querySelector('#gm-reading-solutions-btn');
    if (solBtn) {
      solBtn.addEventListener('click', () => {
        this.toggleReadingSolutions(container);
      });
    }
  }

  /**
   * Wertet Task 1 (Matching Expressions A-F) und Task 2 (Find a Word 1-5) gemeinsam aus.
   */
  evaluateReadingComprehension(container) {
    const task1 = this.topicData.task1_matching || { expressions: [] };
    const task2 = this.topicData.task2_vocabulary || { items: [] };

    let t1Correct = 0;
    const t1Total = (task1.expressions || []).length;
    let newlySolvedXp = 0;

    (task1.expressions || []).forEach((expr, idx) => {
      const sel = container.querySelector(`#gm-match-${expr.id}`);
      const gapEntry = this.gapList[idx];
      if (!sel) return;

      sel.classList.remove('is-correct', 'is-incorrect');
      const userVal = sel.value.trim();
      const isRight = userVal !== '' && Number(userVal) === Number(expr.answer);

      if (isRight) {
        t1Correct += 1;
        sel.classList.add('is-correct');
        if (gapEntry && !gapEntry.solved) {
          gapEntry.solved = true;
          newlySolvedXp += 10;
        }
      } else {
        sel.classList.add('is-incorrect');
      }
    });

    let t2Correct = 0;
    const t2Total = (task2.items || []).length;

    (task2.items || []).forEach((item, idx) => {
      const inp = container.querySelector(`#gm-vocab-${item.id}`);
      const gapEntry = this.gapList[t1Total + idx];
      if (!inp) return;

      inp.classList.remove('is-correct', 'is-incorrect');
      const userNorm = this.normalizeAnswer(inp.value).replace(/[.,!?'"/]/g, '');
      const accepted = (
        Array.isArray(item.acceptedAnswers) && item.acceptedAnswers.length
          ? item.acceptedAnswers
          : [item.answer]
      ).map((a) => this.normalizeAnswer(a).replace(/[.,!?'"/]/g, ''));

      const isRight = userNorm.length > 0 && accepted.includes(userNorm);

      if (isRight) {
        t2Correct += 1;
        inp.classList.add('is-correct');
        if (gapEntry && !gapEntry.solved) {
          gapEntry.solved = true;
          newlySolvedXp += 10;
        }
      } else {
        inp.classList.add('is-incorrect');
      }
    });

    this.readingAttemptCount = (this.readingAttemptCount || 0) + 1;
    this.updateProgressBar();

    if (newlySolvedXp > 0) {
      Gamification.awardXp(newlySolvedXp, 'reading_items_solved');
      const checkBtn = container.querySelector('#gm-reading-check-btn');
      if (checkBtn) UI.spawnFloatingXp(checkBtn, newlySolvedXp);
    }

    const totalCorrect = t1Correct + t2Correct;
    const totalTasks = t1Total + t2Total;
    const percentage = totalTasks > 0 ? (totalCorrect / totalTasks) * 100 : 0;

    let feedbackMsg = '';
    if (percentage === 100) {
      feedbackMsg = `Fantastisch! Alle ${totalTasks} Antworten sind korrekt! Deine Beherrschung des B2-Wortschatzes ist beeindruckend.`;
    } else if (percentage >= 80) {
      feedbackMsg =
        'Sehr gut! Du hast einen Großteil der Aufgaben richtig gelöst. Nur noch kleine Details müssen gefestigt werden.';
    } else if (percentage >= 60) {
      feedbackMsg =
        'Gut gemacht! Du bist auf dem richtigen Weg. Gehe die rot markierten Aufgaben noch einmal durch.';
    } else if (percentage >= 40) {
      feedbackMsg =
        'Motivierendes Ergebnis. Die Grundlagen sind da – prüfe noch einmal die angegebenen Textabschnitte [1]–[6].';
    } else {
      feedbackMsg =
        'Gib nicht auf! Lies die markierten Abschnitte [1]–[6] in Ruhe durch oder nutze "Lösungen anzeigen" zum Lernen.';
    }

    const resultBox = container.querySelector('#gm-reading-result-box');
    if (resultBox) {
      resultBox.hidden = false;
      resultBox.className = `gm-reading-result-box ${
        totalCorrect === totalTasks ? 'is-success' : 'is-failure'
      }`;
      resultBox.innerHTML = `
        <div><strong>${UI.escapeHtml(feedbackMsg)}</strong></div>
        <div style="margin-top: 8px;">
          <strong>Detailergebnis:</strong> ${totalCorrect} von ${totalTasks} (${percentage.toFixed(
        0
      )}%) korrekt.<br>
          Task 1 (Matching): ${t1Correct}/${t1Total} &nbsp;|&nbsp; Task 2 (Synonyme): ${t2Correct}/${t2Total}
        </div>
      `;
    }

    // Show "Lösungen anzeigen" button after an attempt with errors (or anytime after first check)
    const solBtn = container.querySelector('#gm-reading-solutions-btn');
    if (solBtn) {
      solBtn.hidden = false;
    }

    if (totalCorrect === totalTasks) {
      Gamification.playSound('success');
      if (!this.readingExerciseCompleted) {
        this.readingExerciseCompleted = true;
        Gamification.awardXp(50, 'exercise_bonus');
        Gamification.markExerciseSolved({
          topicId: this.topicData.id,
          exerciseId: this.activeExercise.id,
          totalExercises: (this.topicData.exercises || []).length,
          legacyStateKey: this.topicData.legacyStateKey,
          legacyMasteryKey: this.topicData.legacyMasteryKey
        });
      }
    } else {
      Gamification.playSound('incorrect');
    }
  }

  /**
   * Blendet die Musterlösungen für Task 1 und Task 2 ein oder aus.
   */
  toggleReadingSolutions(container) {
    this.readingSolutionsVisible = !this.readingSolutionsVisible;
    const show = this.readingSolutionsVisible;

    container.querySelectorAll('.gm-reading-correct-badge').forEach((badge) => {
      badge.hidden = !show;
    });
    container.querySelectorAll('[data-reading-sol-note]').forEach((note) => {
      note.hidden = !show;
    });

    const solBtn = container.querySelector('#gm-reading-solutions-btn');
    if (solBtn) {
      solBtn.textContent = show ? 'Lösungen verbergen' : 'Lösungen anzeigen';
    }
  }

  /**
   * MODUS 1: Einzelsätze ('single_sentence')
   * Zeigt den aktuellen Satz groß und zentriert mit einem festen, nicht-überlappenden
   * Hinweis-Banner oberhalb des Satzes sowie Fortschritts-Punkten.
   */
  renderSingleSentenceWorkspace(container) {
    const activeGap = this.gapList[this.activeGapFlatIndex];
    if (!activeGap) return;

    const currentSentenceIdx = activeGap.sentenceIndex;
    const sentences = this.activeExercise.sentences || [];
    const sentenceObj = sentences[currentSentenceIdx];

    // Stepper-Dots für alle Lücken
    const dotsHtml = this.gapList
      .map((g, idx) => {
        const classes = [
          'gm-step-dot',
          idx === this.activeGapFlatIndex ? 'is-current' : '',
          g.solved ? 'is-solved' : ''
        ]
          .filter(Boolean)
          .join(' ');
        return `<button type="button" class="${classes}" data-gap-flat="${idx}" aria-label="Satz ${
          idx + 1
        }">${idx + 1}</button>`;
      })
      .join('');

    // Satz mit Lücken-Slots aufbauen
    const sentenceHtml = this.buildSentenceMarkup(sentenceObj, currentSentenceIdx);

    const isKeyWordMode = Boolean(
      sentenceObj.keyWord ||
      sentenceObj.sentence1 ||
      (this.activeExercise && this.activeExercise.type === 'key-word-transformation')
    );
    const isWordFormationMode = Boolean(
      !isKeyWordMode &&
      (sentenceObj.baseWord ||
        (this.activeExercise && this.activeExercise.type === 'word-formation'))
    );

    const keyWordVal = String(
      sentenceObj.keyWord || activeGap.gapData.keyWord || activeGap.gapData.prompt || ''
    )
      .replace(/^KEY\s*WORD:\s*/i, '')
      .trim()
      .toUpperCase();

    const baseWordVal = String(
      sentenceObj.baseWord ||
        sentenceObj.hint ||
        activeGap.gapData.baseWord ||
        activeGap.gapData.prompt ||
        ''
    )
      .trim()
      .toUpperCase();

    const cueText = activeGap.gapData.prompt || activeGap.gapData.gap || '';
    const grammarHint = activeGap.gapData.grammarHint || 'Setze die passende Form ein';

    if (isKeyWordMode) {
      const origSentence = sentenceObj.sentence1 || sentenceObj.lead || '';
      const part1Text = sentenceObj.part1 !== undefined ? sentenceObj.part1 : '';
      const part2Text = sentenceObj.part2 !== undefined ? sentenceObj.part2 : '';
      const gapOnlySlotHtml = this.buildSentenceMarkup(
        { ...sentenceObj, text: '{{0}}' },
        currentSentenceIdx
      );

      container.innerHTML = `
        <div class="gm-single-sentence-layout">
          <div class="gm-step-dots-bar" role="tablist" aria-label="Satz-Navigation">
            ${dotsHtml}
          </div>

          <article class="gm-sentence-focus-card gm-kw-card">
            <div class="gm-non-overlapping-hint-bar">
              <span class="gm-infinitive-pill gm-kw-badge-pill">
                <span class="gm-pill-label">KEY WORD:</span>
                <strong class="gm-kw-badge">${UI.escapeHtml(keyWordVal)}</strong>
              </span>
              <span class="gm-grammar-pill">
                📏 2 to 5 words (inkl. ${UI.escapeHtml(keyWordVal)})
              </span>
            </div>

            <div class="gm-kw-source-box" aria-label="Ausgangssatz">
              <div class="gm-kw-source-label">Original Sentence</div>
              <div class="gm-kw-source-sentence">${UI.escapeHtml(origSentence)}</div>
            </div>

            <div class="gm-kw-keyword-banner">
              <span class="gm-kw-keyword-chip">${UI.escapeHtml(keyWordVal)}</span>
            </div>

            <div class="gm-sentence-display gm-kw-3part-row">
              ${part1Text ? `<span class="gm-kw-part1">${UI.escapeHtml(part1Text)}</span>` : ''}
              <span class="gm-kw-gap-wrapper">${gapOnlySlotHtml}</span>
              ${part2Text ? `<span class="gm-kw-part2">${UI.escapeHtml(part2Text)}</span>` : ''}
            </div>
          </article>
        </div>
      `;
    } else if (isWordFormationMode) {
      container.innerHTML = `
        <div class="gm-single-sentence-layout">
          <div class="gm-step-dots-bar" role="tablist" aria-label="Satz-Navigation">
            ${dotsHtml}
          </div>

          <article class="gm-sentence-focus-card gm-wf-card">
            <div class="gm-non-overlapping-hint-bar">
              <span class="gm-infinitive-pill">
                <span class="gm-pill-label">STAMMWORT / BASE WORD:</span>
                <strong class="gm-wf-baseword-badge">${UI.escapeHtml(baseWordVal)}</strong>
              </span>
              <span class="gm-grammar-pill">
                🧩 Word Formation · Bilde die passende Wortform
              </span>
            </div>

            <div class="gm-sentence-display">
              ${sentenceHtml}
            </div>
          </article>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="gm-single-sentence-layout">
          <div class="gm-step-dots-bar" role="tablist" aria-label="Satz-Navigation">
            ${dotsHtml}
          </div>

          <article class="gm-sentence-focus-card">
            <!-- Fester, niemals überlappender Hinweis-Header oberhalb des Satzes -->
            <div class="gm-non-overlapping-hint-bar">
              <span class="gm-infinitive-pill">
                <span class="gm-pill-label">Infinitiv / Vorgabe:</span>
                <strong>(${UI.escapeHtml(cueText)})</strong>
              </span>
              <span class="gm-grammar-pill">
                🧭 ${UI.escapeHtml(grammarHint)}
              </span>
            </div>

            <div class="gm-sentence-display">
              ${sentenceHtml}
            </div>
          </article>
        </div>
      `;
    }

    this.bindGapSlotClicks(container);

    container.querySelectorAll('.gm-step-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        const idx = parseInt(dot.dataset.gapFlat || '0', 10);
        this.activateGap(idx, true);
      });
    });
  }

  /**
   * MODUS 2: Zusammenhängender Lückentext ('cloze_text')
   * Scrollfreies 100dvh-Layout mit nicht-überlappenden Mini-Prompts direkt oberhalb jeder Lücke.
   */
  renderClozeWorkspace(container) {
    const sentences = this.activeExercise.sentences || [];
    const paragraphsHtml = sentences
      .map((sentenceObj, sIdx) => {
        return `<span class="gm-cloze-sentence">${this.buildSentenceMarkup(
          sentenceObj,
          sIdx,
          true
        )}</span>`;
      })
      .join(' ');

    container.innerHTML = `
      <div class="gm-cloze-card">
        <div class="gm-cloze-passage">
          ${paragraphsHtml}
        </div>
      </div>
    `;

    this.bindGapSlotClicks(container);
  }

  /**
   * Ersetzt '{{gap}}' (oder '{{0}}', '{{1}}') im Satz-String durch interaktive,
   * nicht-überlappende Lücken-Slots.
   */
  buildSentenceMarkup(sentenceObj, sentenceIndex, isClozeMode = false) {
    let rawText = sentenceObj.text || '';
    const gapsInSentence = this.gapList.filter((g) => g.sentenceIndex === sentenceIndex);

    let localGapPointer = 0;

    // Unterstütze sowohl {{gap}}, {gap} als auch {{0}}, {{1}}
    const replaced = rawText.replace(/\{\{(?:gap|\d+)\}\}|\{gap\}/g, () => {
      const gapItem = gapsInSentence[localGapPointer];
      localGapPointer += 1;
      if (!gapItem) return '___';

      const cue =
        gapItem.gapData.baseWord ||
        gapItem.gapData.keyWord ||
        gapItem.gapData.prompt ||
        gapItem.gapData.gap ||
        '';
      const isCurrent = gapItem.flatIndex === this.activeGapFlatIndex;
      const stateClass = gapItem.solved
        ? 'is-correct'
        : isCurrent
        ? 'is-active'
        : gapItem.hintStep > 0
        ? 'is-hinted'
        : '';

      const displayValue =
        gapItem.value.trim().length > 0 ? gapItem.value : `(${cue})`;
      const hasValueClass = gapItem.value.trim().length > 0 ? 'has-value' : '';

      return `<span class="gm-inline-gap-group ${isClozeMode ? 'is-cloze' : 'is-single'}">
        <span class="gm-gap-cue-above" aria-hidden="true">${UI.escapeHtml(cue)}</span>
        <button
          type="button"
          class="gm-gap-slot ${stateClass} ${hasValueClass}"
          id="gm-gap-slot-${gapItem.flatIndex}"
          data-gap-flat="${gapItem.flatIndex}"
          aria-label="Lücke ${gapItem.flatIndex + 1}: Vorgabe ${UI.escapeHtml(cue)}"
        >
          <span class="gm-gap-num">${gapItem.flatIndex + 1}</span>
          <span class="gm-gap-value">${UI.escapeHtml(displayValue)}</span>
        </button>
      </span>`;
    });

    return replaced;
  }

  /**
   * Verbindet Klicks auf Lücken-Buttons im Text mit activateGap().
   */
  bindGapSlotClicks(container) {
    container.querySelectorAll('.gm-gap-slot').forEach((btn) => {
      btn.addEventListener('click', () => {
        const flatIdx = parseInt(btn.dataset.gapFlat || '0', 10);
        this.activateGap(flatIdx, true);
      });
    });
  }

  /**
   * Liefert das DOM-Element eines Lücken-Slots anhand seines Flat-Index.
   */
  getGapSlotElement(flatIndex) {
    return document.getElementById(`gm-gap-slot-${flatIndex}`);
  }

  /**
   * Aktiviert eine Lücke, synchronisiert die untere Eingabezeile und hebt die Lücke hervor.
   */
  activateGap(flatIndex, autoFocus = true) {
    if (flatIndex < 0 || flatIndex >= this.gapList.length) return;

    const prevIndex = this.activeGapFlatIndex;
    this.activeGapFlatIndex = flatIndex;
    this.awaitingNextStep = false;

    const targetGap = this.gapList[flatIndex];

    if (this.activeExercise && this.activeExercise.type !== 'cloze_text') {
      const container = document.getElementById('gm-stage-workspace');
      if (container) {
        this.renderSingleSentenceWorkspace(container);
      }
    } else {
      // Im Cloze-Modus nur aktive Klassen umschalten, ohne das DOM neu zu bauen
      const prevSlot = this.getGapSlotElement(prevIndex);
      if (prevSlot) prevSlot.classList.remove('is-active');

      const nextSlot = this.getGapSlotElement(flatIndex);
      if (nextSlot) {
        nextSlot.classList.add('is-active');
        UI.ensureGapVisible(nextSlot);
      }
    }

    UI.updateInputDock({
      gapData: targetGap.gapData,
      currentValue: targetGap.value,
      isSolved: targetGap.solved,
      hintUsed: targetGap.hintStep > 0,
      gapIndex: flatIndex,
      totalGaps: this.gapList.length,
      autoFocus
    });

    if (targetGap.solved) {
      UI.showFeedbackDrawer({
        type: 'correct',
        title: 'Bereits gelöst ✓',
        message: targetGap.gapData.explanation || '',
        solution: targetGap.gapData.solutions[0],
        actionLabel: 'Nächste Lücke',
        onAction: () => this.advanceToNextUnsolvedGap()
      });
    } else {
      UI.hideFeedbackDrawer();
    }
  }

  /**
   * Wechselt per Tab / Shift+Tab zur nächsten bzw. vorherigen Lücke.
   */
  cycleGap(direction = 1) {
    if (!this.gapList.length) return;
    const nextIdx =
      (this.activeGapFlatIndex + direction + this.gapList.length) % this.gapList.length;
    this.activateGap(nextIdx, true);
  }

  /**
   * Haupt-Aktion bei Klick auf "Prüfen ↵" oder Drücken der Enter-Taste.
   */
  handlePrimaryAction() {
    const currentGap = this.gapList[this.activeGapFlatIndex];
    if (!currentGap) return;

    // Wenn bereits gelöst oder nach korrekter Antwort auf "Weiter" gewartet wird:
    if (currentGap.solved || this.awaitingNextStep) {
      this.advanceToNextUnsolvedGap();
      return;
    }

    this.evaluateActiveGap();
  }

  /**
   * Normalisiert Nutzereingaben und Lösungen für fairen, case-insensitiven Vergleich
   * (trimmt Whitespaces, vereinheitlicht Apostrophe, entfernt optionale Ellipsen/Satzpunkte).
   */
  normalizeAnswer(str) {
    return String(str || '')
      .replace(/[’‘`´]/g, "'")
      .replace(/^\.{2,}\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Erzeugt alle akzeptierten Vergleichsvarianten einer Musterlösung
   * (inkl. Variante ohne Klammerzusatz und ohne abschließenden Punkt).
   */
  expandNormalizedVariants(solutionStr) {
    const base = this.normalizeAnswer(solutionStr);
    const variants = new Set([base]);
    // Ohne abschließenden Punkt/Ausrufezeichen
    variants.add(base.replace(/[.!]+$/, '').trim());
    // Ohne Klammerzusatz wie "subject (wer?)" -> "subject"
    const withoutParens = base.replace(/\s*\([^)]*\)/g, '').trim();
    if (withoutParens) {
      variants.add(withoutParens);
      variants.add(withoutParens.replace(/[.!]+$/, '').trim());
    }
    return Array.from(variants).filter(Boolean);
  }

  /**
   * Prüft die Eingabe der aktiven Lücke gegen alle gültigen Lösungen (case-insensitive).
   */
  evaluateActiveGap() {
    const currentGap = this.gapList[this.activeGapFlatIndex];
    const dockInput = document.getElementById('gm-dock-input');
    if (!currentGap || !dockInput) return;

    const rawInput = dockInput.value;
    currentGap.value = rawInput;
    const normalizedUser = this.normalizeAnswer(rawInput);
    const normalizedUserNoDot = normalizedUser.replace(/[.!]+$/, '').trim();

    if (!normalizedUser) {
      dockInput.focus();
      return;
    }

    const rawSolutions =
      currentGap.gapData.solutions || currentGap.gapData.acceptedAnswers || [];
    let matchedIdx = -1;
    for (let i = 0; i < rawSolutions.length; i += 1) {
      const variants = this.expandNormalizedVariants(rawSolutions[i]);
      if (variants.includes(normalizedUser) || variants.includes(normalizedUserNoDot)) {
        matchedIdx = i;
        break;
      }
    }
    const isCorrect = matchedIdx !== -1;
    const slotEl = this.getGapSlotElement(this.activeGapFlatIndex);

    if (isCorrect) {
      currentGap.solved = true;
      this.awaitingNextStep = true;

      // Kanonische Schreibweise übernehmen, falls Groß-/Kleinschreibung abweicht
      const canonical = rawSolutions[matchedIdx] || rawSolutions[0];
      currentGap.value = canonical;

      UI.syncGapSlotDOM({
        gapSlotEl: slotEl,
        value: canonical,
        prompt: currentGap.gapData.prompt || currentGap.gapData.gap,
        state: 'correct'
      });

      UI.updateInputDock({
        gapData: currentGap.gapData,
        currentValue: canonical,
        isSolved: true,
        hintUsed: currentGap.hintStep > 0,
        gapIndex: this.activeGapFlatIndex,
        totalGaps: this.gapList.length,
        autoFocus: false
      });

      Gamification.playSound('correct');
      Gamification.awardXp(10, 'gap_solved');
      UI.spawnFloatingXp(slotEl || dockInput, 10);

      this.updateProgressBar();

      const allDone = this.gapList.every((g) => g.solved);

      UI.showFeedbackDrawer({
        type: 'correct',
        title: 'Richtig! +10 XP',
        message: currentGap.gapData.explanation || 'Perfekt gelöst!',
        actionLabel: allDone ? 'Übung abschließen' : 'Weiter',
        onAction: () => this.advanceToNextUnsolvedGap()
      });
    } else {
      currentGap.attempts += 1;
      Gamification.playSound('incorrect');

      dockInput.classList.remove('is-incorrect');
      // Force reflow für erneute Shake-Animation
      void dockInput.offsetWidth;
      dockInput.classList.add('is-incorrect');

      UI.syncGapSlotDOM({
        gapSlotEl: slotEl,
        value: rawInput,
        prompt: currentGap.gapData.prompt || currentGap.gapData.gap,
        state: 'incorrect'
      });

      const showSolutionNow = currentGap.attempts >= 2;
      const hintFallback =
        (currentGap.gapData.hints && currentGap.gapData.hints[0]) ||
        currentGap.gapData.explanation ||
        'Prüfe Zeitform und Person noch einmal genau.';

      UI.showFeedbackDrawer({
        type: 'incorrect',
        title:
          currentGap.attempts === 1
            ? 'Noch nicht ganz – versuch es nochmal!'
            : 'Hinweis & Erklärung',
        message: showSolutionNow
          ? currentGap.gapData.explanation || hintFallback
          : hintFallback,
        solution: showSolutionNow ? currentGap.gapData.solutions[0] : ''
      });

      dockInput.focus();
      dockInput.select();
    }
  }

  /**
   * Springt zur nächsten noch ungelösten Lücke oder schließt die Übung ab,
   * wenn alle Lücken gelöst wurden.
   */
  advanceToNextUnsolvedGap() {
    const allSolved = this.gapList.every((g) => g.solved);
    if (allSolved) {
      this.completeCurrentExercise();
      return;
    }

    // Suche nächste ungelöste Lücke ab aktueller Position
    const total = this.gapList.length;
    for (let offset = 1; offset <= total; offset++) {
      const candidateIdx = (this.activeGapFlatIndex + offset) % total;
      if (!this.gapList[candidateIdx].solved) {
        this.activateGap(candidateIdx, true);
        return;
      }
    }
  }

  /**
   * Löst einen Tipp (-5 XP) für die aktive Lücke aus:
   * - Animiert das "-5 XP" Badge sanft nach oben weg (ohne Klickbereiche zu blockieren)
   * - Füllt den Anfangsbuchstaben / Wortanfang ein
   * - Zeigt den didaktischen Tipp im Feedback-Drawer
   */
  triggerHint() {
    const currentGap = this.gapList[this.activeGapFlatIndex];
    const hintBtn = document.getElementById('gm-dock-hint-btn');
    const dockInput = document.getElementById('gm-dock-input');
    if (!currentGap || currentGap.solved) return;

    const targetSolution = (currentGap.gapData.solutions || [''])[0];
    if (!targetSolution) return;

    // Beim ersten Tipp-Klick für diese Lücke -5 XP abziehen & Floating Badge spawnen
    if (currentGap.hintStep === 0) {
      Gamification.deductXp(5, 'hint');
      Gamification.playSound('hint');
      UI.spawnFloatingXp(hintBtn || dockInput, -5, '-5 XP');
    } else {
      Gamification.playSound('hint');
    }

    currentGap.hintStep += 1;

    // Fülle die ersten Zeichen als Starthilfe ein
    const revealChars = Math.min(currentGap.hintStep === 1 ? 1 : 3, targetSolution.length);
    const starterText = targetSolution.slice(0, revealChars);

    if (!currentGap.value || !targetSolution.toLowerCase().startsWith(currentGap.value.toLowerCase())) {
      currentGap.value = starterText;
    }

    const slotEl = this.getGapSlotElement(this.activeGapFlatIndex);
    UI.syncGapSlotDOM({
      gapSlotEl: slotEl,
      value: currentGap.value,
      prompt: currentGap.gapData.prompt || currentGap.gapData.gap,
      state: 'hinted'
    });

    UI.updateInputDock({
      gapData: currentGap.gapData,
      currentValue: currentGap.value,
      isSolved: false,
      hintUsed: true,
      gapIndex: this.activeGapFlatIndex,
      totalGaps: this.gapList.length,
      autoFocus: true
    });

    if (dockInput) {
      dockInput.setSelectionRange(currentGap.value.length, currentGap.value.length);
    }

    const hintsArr = currentGap.gapData.hints || [];
    const hintText =
      hintsArr[Math.min(currentGap.hintStep - 1, hintsArr.length - 1)] ||
      currentGap.gapData.grammarHint ||
      `Die gesuchte Form beginnt mit "${starterText}…"`;

    UI.showFeedbackDrawer({
      type: 'hint',
      title: `💡 Tipp: Beginnt mit "${starterText}…"`,
      message: hintText
    });
  }

  /**
   * Schlusspunkt einer vollständig gelösten Übungseinheit:
   * Vergibt +50 XP Abschluss-Bonus, speichert den Fortschritt und zeigt das Erfolgs-Modal.
   */
  completeCurrentExercise() {
    UI.hideFeedbackDrawer();

    const bonusXp = 50;
    Gamification.awardXp(bonusXp, 'exercise_bonus');
    Gamification.playSound('success');

    const totalExercises = (this.topicData.exercises || []).length;
    const masteryResult = Gamification.markExerciseSolved({
      topicId: this.topicData.id,
      exerciseId: this.activeExercise.id,
      totalExercises,
      legacyStateKey: this.topicData.legacyStateKey,
      legacyMasteryKey: this.topicData.legacyMasteryKey
    });

    const hasNext = this.activeExerciseIndex + 1 < totalExercises;

    UI.showExerciseCompletionModal({
      exerciseTitle: this.activeExercise.title,
      bonusXp,
      hasNextExercise: hasNext,
      topicMastered: masteryResult.allSolved,
      topicTitle: this.topicData.title,
      onNext: () => this.startExercise(this.activeExerciseIndex + 1),
      onOverview: () => this.showStartScreen()
    });
  }

  /**
   * Öffnet oder schließt das kompakte Grammatik-Regel-Modal während einer laufenden Übung.
   */
  toggleRulesModal() {
    const existing = document.getElementById('gm-rules-modal');
    if (existing) {
      existing.remove();
      return;
    }
    if (!this.topicData || !this.topicData.rules) return;

    const rules = this.topicData.rules;
    const overlay = document.createElement('div');
    overlay.id = 'gm-rules-modal';
    overlay.className = 'gm-modal-overlay';

    const sectionsHtml = (rules.sections || [])
      .map(
        (sec) => `
        <div class="gm-rule-box">
          <h4 class="gm-rule-box-title">${UI.formatInlineMarkdown(sec.title)}</h4>
          <div class="gm-rule-formula">${UI.formatInlineMarkdown(sec.formula)}</div>
          ${
            sec.examples && sec.examples.length
              ? `<ul class="gm-rule-examples">
                   ${sec.examples.map((ex) => `<li>${UI.formatInlineMarkdown(ex)}</li>`).join('')}
                 </ul>`
              : ''
          }
        </div>
      `
      )
      .join('');

    overlay.innerHTML = `
      <div class="gm-modal-card gm-modal-wide">
        <div class="gm-modal-header-row">
          <div>
            <div class="gm-modal-eyebrow">STRATEGY &amp; RULES CHECK</div>
            <h3 class="gm-modal-title">${UI.escapeHtml(this.topicData.title)}</h3>
          </div>
          <button type="button" class="gm-feedback-close-btn" id="gm-rules-close-btn" aria-label="Schließen">✕</button>
        </div>
        <p class="gm-modal-desc">${UI.formatInlineMarkdown(rules.summary || '')}</p>
        ${
          rules.warning
            ? `<div class="gm-rule-warning">${UI.formatInlineMarkdown(rules.warning)}</div>`
            : ''
        }
        <div class="gm-rules-grid">
          ${sectionsHtml}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const closeBtn = overlay.querySelector('#gm-rules-close-btn');
    if (closeBtn) closeBtn.onclick = () => overlay.remove();
  }

  closeRulesModal() {
    const existing = document.getElementById('gm-rules-modal');
    if (existing) existing.remove();
    const snippetDrawer = document.getElementById('gm-reading-snippet-drawer');
    if (snippetDrawer) snippetDrawer.hidden = true;
  }
}

// Auto-Bootstrapping wenn auf exercise.html eingebunden
if (typeof window !== 'undefined') {
  window.__GM_MODULE_BOOTED = true;
}
if (typeof document !== 'undefined') {
  const boot = () => {
    if (document.getElementById('gm-exercise-app') && !window.gmEngineInstance) {
      const engine = new GrammarEngine();
      window.gmEngineInstance = engine;
      engine.init();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

export default GrammarEngine;
