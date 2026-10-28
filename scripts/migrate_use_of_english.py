#!/usr/bin/env python3
"""
Migration & Linguistic Sanitization Script for Use of English (Units 1-4)
Extracts Word Formation (u1-u4) and Key-Word Transformation (u1-u4) from legacy HTML
files, applies Cambridge B2 linguistic sanitization, generates UK/US & contraction
alternatives in acceptedAnswers, and outputs modular JSON datasets under data/topics/.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOPICS_DIR = ROOT / "data" / "topics"
LEGACY_DIR = ROOT / "_legacy"


def find_source_html(filename: str) -> Path:
    p_root = ROOT / filename
    if p_root.exists():
        return p_root
    p_legacy = LEGACY_DIR / filename
    if p_legacy.exists():
        return p_legacy
    raise FileNotFoundError(f"Could not find {filename} in {ROOT} or {LEGACY_DIR}")


def extract_js_tasks_from_html(filepath: Path) -> list:
    text = filepath.read_text(encoding="utf-8")
    m = re.search(r"const\s+allTasks\s*=\s*(\{.*?\n\s*\});", text, flags=re.S)
    if not m:
        raise ValueError(f"Could not find allTasks object in {filepath}")
    raw_js = m.group(1)
    lines = []
    for line in raw_js.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        line = re.sub(r'\s*//[^"]*$', "", line)
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"(?m)^(\s*)(\d+)\s*:", r'\1"\2":', cleaned)
    cleaned = re.sub(
        r'(?<=[{\s,])(id|task|level|exercises|sentence1|sentence2_part1|sentence2_part2|sentence|part1|part2|key_word|answer|hint)\s*:',
        r'"\1":',
        cleaned,
    )
    cleaned = re.sub(r",\s*([\]}])", r"\1", cleaned)
    obj = json.loads(cleaned)
    tasks_list = []
    for k in sorted(obj.keys(), key=lambda x: int(x)):
        item = obj[k]
        exs = []
        for ex in item["exercises"]:
            norm_ex = dict(ex)
            if "sentence2_part1" in norm_ex and "part1" not in norm_ex:
                norm_ex["part1"] = norm_ex.pop("sentence2_part1")
            if "sentence2_part2" in norm_ex and "part2" not in norm_ex:
                norm_ex["part2"] = norm_ex.pop("sentence2_part2")
            if "sentence" in norm_ex:
                norm_ex["sentence"] = re.sub(r"_{3,}", "{gap}", norm_ex["sentence"])
            exs.append(norm_ex)
        tasks_list.append(
            {
                "task": int(k),
                "level": item["level"],
                "exercises": exs,
            }
        )
    return tasks_list


def expand_contractions_and_spelling(ans: str) -> list[str]:
    """Generate accepted answers including UK/US spelling variants and contractions."""
    base = " ".join(ans.strip().split())
    variants = {base}

    contraction_pairs = [
        (r"\bwas not\b", "wasn't"),
        (r"\bwere not\b", "weren't"),
        (r"\bdid not\b", "didn't"),
        (r"\bdo not\b", "don't"),
        (r"\bdoes not\b", "doesn't"),
        (r"\bhad not\b", "hadn't"),
        (r"\bhas not\b", "hasn't"),
        (r"\bhave not\b", "haven't"),
        (r"\bwill not\b", "won't"),
        (r"\bwould not\b", "wouldn't"),
        (r"\bcould not\b", "couldn't"),
        (r"\bshould not\b", "shouldn't"),
        (r"\bneed not\b", "needn't"),
        (r"\bmust not\b", "mustn't"),
        (r"\bcannot\b", "can't"),
        (r"\bcan not\b", "can't"),
        (r"\bis not\b", "isn't"),
        (r"\bare not\b", "aren't"),
        (r"\bI am\b", "I'm"),
        (r"\bI had\b", "I'd"),
        (r"\bI would\b", "I'd"),
        (r"\bhe had\b", "he'd"),
        (r"\bshe had\b", "she'd"),
        (r"\bthey had\b", "they'd"),
        (r"\bwe had\b", "we'd"),
        (r"\byou had\b", "you'd"),
        (r"\bit is\b", "it's"),
        (r"\bthat is\b", "that's"),
        (r"\bthere is\b", "there's"),
    ]

    for full_pat, contr in contraction_pairs:
        for v in list(variants):
            if re.search(full_pat, v, flags=re.I):
                replaced = re.sub(full_pat, contr, v, flags=re.I)
                if v[0].isupper() and replaced[0].islower():
                    replaced = replaced[0].upper() + replaced[1:]
                variants.add(replaced)
            if re.search(r"\b" + re.escape(contr) + r"\b", v, flags=re.I):
                full_str = full_pat.replace(r"\b", "")
                replaced = re.sub(r"\b" + re.escape(contr) + r"\b", full_str, v, flags=re.I)
                if v[0].isupper() and replaced[0].islower():
                    replaced = replaced[0].upper() + replaced[1:]
                variants.add(replaced)

    uk_us_swaps = [
        ("organizing", "organising"),
        ("organize", "organise"),
        ("organized", "organised"),
        ("organization", "organisation"),
        ("analyzing", "analysing"),
        ("analyze", "analyse"),
        ("analyzed", "analysed"),
        ("minimizing", "minimising"),
        ("minimize", "minimise"),
        ("minimized", "minimised"),
        ("minimization", "minimisation"),
        ("marginalization", "marginalisation"),
        ("marginalize", "marginalise"),
        ("marginalized", "marginalised"),
        ("realize", "realise"),
        ("realized", "realised"),
        ("realizing", "realising"),
        ("apologize", "apologise"),
        ("apologized", "apologised"),
        ("apologizing", "apologising"),
        ("recognizing", "recognising"),
        ("recognize", "recognise"),
        ("recognized", "recognised"),
        ("criticize", "criticise"),
        ("criticized", "criticised"),
        ("criticizing", "criticising"),
        ("prioritize", "prioritise"),
        ("prioritizing", "prioritising"),
        ("emphasize", "emphasise"),
        ("emphasizing", "emphasising"),
        ("favor", "favour"),
        ("favorable", "favourable"),
        ("unfavorable", "unfavourable"),
        ("behavior", "behaviour"),
        ("behavioral", "behavioural"),
        ("center", "centre"),
        ("centered", "centred"),
        ("traveling", "travelling"),
        ("traveled", "travelled"),
        ("canceled", "cancelled"),
        ("canceling", "cancelling"),
        ("fulfill", "fulfil"),
        ("fulfillment", "fulfilment"),
        ("defense", "defence"),
        ("offense", "offence"),
    ]

    for us_word, uk_word in uk_us_swaps:
        for v in list(variants):
            if re.search(r"\b" + us_word + r"\b", v, flags=re.I):
                variants.add(re.sub(r"\b" + us_word + r"\b", uk_word, v, flags=re.I))
            if re.search(r"\b" + uk_word + r"\b", v, flags=re.I):
                variants.add(re.sub(r"\b" + uk_word + r"\b", us_word, v, flags=re.I))

    ordered = [base]
    for v in sorted(variants):
        if v not in ordered:
            ordered.append(v)
    return ordered


def count_words(phrase: str) -> int:
    return len([w for w in phrase.strip().split() if w])


def sanitize_key_word_units() -> dict[int, list]:
    """Extract and sanitize Key-Word Transformation Units 1-4."""
    units = {}
    for u in range(1, 5):
        raw_tasks = extract_js_tasks_from_html(find_source_html(f"key_word_u{u}.html"))
        units[u] = raw_tasks

    # In key_word_u1.html, Tasks 6 and 7 were omitted in the legacy HTML (jumped 5 -> 8).
    u1_tasks_by_id = {t["task"]: t for t in units[1]}
    if 6 not in u1_tasks_by_id:
        u1_tasks_by_id[6] = {
            "task": 6,
            "level": "Intermediate",
            "exercises": [
                {
                    "sentence1": "It wasn't necessary for you to bring all those documents to the interview.",
                    "part1": "You",
                    "part2": "all those documents to the interview.",
                    "key_word": "NEED",
                    "answer": "need not have brought",
                    "extra_answers": ["needn't have brought", "did not need to bring", "didn't need to bring"],
                },
                {
                    "sentence1": "They believe the hacker gained access through an unprotected server.",
                    "part1": "The hacker is",
                    "part2": "access through an unprotected server.",
                    "key_word": "BELIEVED",
                    "answer": "believed to have gained",
                },
                {
                    "sentence1": "I regret not taking the opportunity to study abroad when I was at university.",
                    "part1": "I wish",
                    "part2": "the opportunity to study abroad when I was at university.",
                    "key_word": "TAKEN",
                    "answer": "I had taken",
                    "extra_answers": ["I'd taken"],
                },
                {
                    "sentence1": "The concert was cancelled because the lead singer fell ill suddenly.",
                    "part1": "The concert had to be",
                    "part2": "the lead singer's sudden illness.",
                    "key_word": "OWING",
                    "answer": "called off owing to",
                    "extra_answers": ["cancelled owing to", "canceled owing to"],
                },
                {
                    "sentence1": "It is possible that the courier delivered the parcel to the wrong address.",
                    "part1": "The courier",
                    "part2": "the parcel to the wrong address.",
                    "key_word": "MIGHT",
                    "answer": "might have delivered",
                },
            ],
        }
    if 7 not in u1_tasks_by_id:
        u1_tasks_by_id[7] = {
            "task": 7,
            "level": "Intermediate",
            "exercises": [
                {
                    "sentence1": "She found it impossible to tolerate the constant noise from the construction site.",
                    "part1": "She could not",
                    "part2": "the constant noise from the construction site.",
                    "key_word": "PUT",
                    "answer": "put up with",
                },
                {
                    "sentence1": "Nobody expected the new startup to succeed so quickly in the global market.",
                    "part1": "Nobody expected the new startup",
                    "part2": "so quickly in the global market.",
                    "key_word": "TAKE",
                    "answer": "to take off",
                },
                {
                    "sentence1": "There is no chance that the board will approve the budget without further cuts.",
                    "part1": "The board is",
                    "part2": "the budget without further cuts.",
                    "key_word": "UNLIKELY",
                    "answer": "unlikely to approve",
                    "extra_answers": ["highly unlikely to approve"],
                },
                {
                    "sentence1": "He started working on the research project three months ago.",
                    "part1": "He",
                    "part2": "the research project for three months.",
                    "key_word": "BEEN",
                    "answer": "has been working on",
                },
                {
                    "sentence1": "You should make a backup copy of your files in case your computer crashes.",
                    "part1": "You had",
                    "part2": "a backup copy of your files in case your computer crashes.",
                    "key_word": "BETTER",
                    "answer": "better make",
                    "extra_answers": ["better create"],
                },
            ],
        }

    units[1] = [u1_tasks_by_id[k] for k in sorted(u1_tasks_by_id.keys())]

    # Specific linguistic sanitization overrides keyed by (unit, task_id, exercise_index_1based)
    overrides = {
        # UNIT 1 (matches key_word_u1.html)
        (1, 1, 4): {
            # "I wish I hadn't accepted the job offer, it was a mistake."
            "part1": "I wish",
            "part2": "the job offer.",
            "key_word": "DOWN",
            "answer": "I had turned down",
            "extra_answers": ["I'd turned down"],
        },
        (1, 3, 2): {
            # "I regret spending so much money on unnecessary gadgets."
            # Legacy had key_word: SPENT, part2: "spent so much...", answer: "I wish I hadn't" (missing SPENT in answer!)
            "part1": "I wish",
            "part2": "so much money on unnecessary gadgets.",
            "key_word": "SPENT",
            "answer": "I had not spent",
            "extra_answers": ["I hadn't spent"],
        },
        (1, 3, 5): {
            # Legacy had key_word: HAVE, answer: "needn't have waited"
            "answer": "need not have waited",
            "extra_answers": ["needn't have waited", "did not have to wait", "didn't have to wait"],
        },
        (1, 5, 3): {
            # "The two sides failed to reach an agreement despite long negotiations."
            "part1": "The negotiations did not manage to",
            "part2": "between the two sides.",
            "key_word": "BREAK",
            "answer": "break the deadlock",
            "extra_answers": ["bring about a breakthrough", "reach a breakthrough"],
        },
        (1, 8, 3): {
            # "I wish I had been informed about the decision earlier."
            "part1": "If",
            "part2": "informed about the decision earlier.",
            "key_word": "ONLY",
            "answer": "only I had been",
            "extra_answers": ["only I'd been"],
        },
        (1, 8, 4): {
            # Legacy had key_word: DESERVE, answer: "deserves to get the"
            "key_word": "DESERVES",
            "answer": "deserves to get the",
            "extra_answers": ["really deserves the"],
        },
        (1, 10, 4): {
            "part1": "The committee said there was",
            "part2": "in reversing the decision.",
            "key_word": "NO",
            "answer": "no point",
            "extra_answers": ["no sense", "no possibility"],
        },

        # UNIT 2 (matches key_word_u2.html)
        (2, 2, 1): {
            "answer": "cannot stand people being",
            "extra_answers": ["can't stand people being"],
        },
        (2, 3, 5): {
            "answer": "I should not have trusted",
            "extra_answers": ["I shouldn't have trusted"],
        },
        (2, 4, 1): {
            # Was 1-word error: "make"
            "part1": "The committee will",
            "part2": "next week.",
            "key_word": "MAKE",
            "answer": "make the final decision",
            "extra_answers": ["make a final decision", "make its final decision"],
        },
        (2, 5, 2): {
            # Was ungrammatical: "It was only by reading did I get..."
            "part1": "",
            "part2": "the whole report did I get an insight into the company's problems.",
            "key_word": "ONLY",
            "answer": "Only by reading",
            "extra_answers": ["Only after reading", "Only when I read"],
        },
        (2, 7, 4): {
            # Was 1-word error: "insisted"
            "part1": "The manager",
            "part2": "all employees arrived on time for the meeting.",
            "key_word": "INSISTED",
            "answer": "insisted that",
            "extra_answers": ["insisted on ensuring that"],
        },
        (2, 10, 3): {
            "answer": "could not have fixed it",
            "extra_answers": ["couldn't have fixed it"],
        },

        # UNIT 3 (matches key_word_u3.html)
        (3, 1, 3): {
            # Legacy had key_word: FIND, answer: "found it difficult"
            "key_word": "FOUND",
            "answer": "found it difficult",
            "extra_answers": ["found it hard"],
        },
        (3, 2, 1): {
            # Legacy had key_word: FOR, part2: "for your help...", answer: "it hadn't been" (missing FOR)
            "part1": "If",
            "part2": "your help, I couldn't have finished the report.",
            "key_word": "FOR",
            "answer": "it had not been for",
            "extra_answers": ["it hadn't been for"],
        },
        (3, 5, 4): {
            "answer": "could not wait to go",
            "extra_answers": ["couldn't wait to go"],
        },
        (3, 10, 3): {
            # Was 1-word error: "sank"
            "part1": "The company",
            "part2": "during the financial crisis.",
            "key_word": "SANK",
            "answer": "sank slowly but surely",
        },

        # UNIT 4 (matches key_word_u4.html - all 1-word errors & key-word omissions fixed)
        (4, 2, 2): {
            # Was 1-word error: "unless"
            "part1": "We will",
            "part2": "we unite now.",
            "key_word": "UNLESS",
            "answer": "lose the battle unless",
            "extra_answers": ["not win unless", "fail unless"],
        },
        (4, 3, 1): {
            # Was 1-word error: "organize" with key_word "SYSTEMATIC"
            "part1": "She",
            "part2": "everything systematically and logically.",
            "key_word": "ORGANIZING",
            "answer": "is capable of organizing",
            "extra_answers": [
                "is capable of organising",
                "has a talent for organizing",
                "has a talent for organising",
                "is good at organizing",
                "is good at organising",
            ],
        },
        (4, 4, 1): {
            # Was 1-word error: "investigate"
            "part1": "The police searched the entire area",
            "part2": "the crime.",
            "key_word": "INVESTIGATE",
            "answer": "in order to investigate",
            "extra_answers": ["so as to investigate", "to thoroughly investigate", "to investigate"],
        },
        (4, 4, 2): {
            # Was 1-word error: "final"
            "part1": "He said",
            "part2": "and was not open to question.",
            "key_word": "FINAL",
            "answer": "his decision was final",
            "extra_answers": ["the decision was final", "that his decision was final"],
        },
        (4, 5, 4): {
            # Legacy had key_word: COULD, answer: "If only" (missing COULD in answer!)
            "part1": "",
            "part2": "witnessed the transition to democracy.",
            "key_word": "COULD",
            "answer": "If only I could have",
            "extra_answers": ["I wish I could have"],
        },
        (4, 6, 5): {
            # Legacy had 1-word "trade-off"
            "part1": "They finally",
            "part2": "on the details of the agreement.",
            "key_word": "TRADE",
            "answer": "made a trade-off",
            "extra_answers": ["reached a trade-off", "agreed on a trade-off"],
        },
        (4, 7, 2): {
            # Was 1-word error: "seldom"
            "part1": "",
            "part2": "a mistake when transcribing data.",
            "key_word": "SELDOM",
            "answer": "Seldom does he make",
            "extra_answers": ["He seldom makes"],
        },
        (4, 7, 4): {
            # Was 1-word error: "tackling"
            "part1": "He said",
            "part2": "of toxic waste was hard work.",
            "key_word": "TACKLING",
            "answer": "tackling the sheer volume",
            "extra_answers": ["that tackling the volume"],
        },
        (4, 7, 5): {
            # Was 1-word error: "if"
            "part1": "They will approve the funds",
            "part2": "all the candidates are examined.",
            "key_word": "IF",
            "answer": "only if",
            "extra_answers": ["provided that"],
        },
        (4, 8, 3): {
            # Was 1-word error: "in"
            "part1": "The team's manager is the person",
            "part2": "the transformation.",
            "key_word": "IN",
            "answer": "in charge of",
            "extra_answers": ["who is in charge of"],
        },
        (4, 8, 5): {
            # Was 1-word error: "accusation"
            "part1": "The scientist",
            "part2": "exaggerating the amount of damage.",
            "key_word": "ACCUSATION",
            "answer": "faced an accusation of",
            "extra_answers": ["faced the accusation of"],
        },
        (4, 10, 1): {
            # Legacy had nonsensical "on account of" after "was greater"
            "part1": "The sheer volume of floodwater was far",
            "part2": "had prepared for.",
            "key_word": "THAN",
            "answer": "greater than anyone",
            "extra_answers": ["more than anyone"],
        },
        (4, 10, 2): {
            # Was 1-word error: "unless"
            "part1": "The team",
            "part2": "they receive additional funding.",
            "key_word": "UNLESS",
            "answer": "will not succeed unless",
            "extra_answers": ["won't succeed unless", "cannot succeed unless", "can't succeed unless"],
        },
    }

    sanitized_units = {}
    for u, raw_tasks in units.items():
        clean_tasks = []
        for t in raw_tasks:
            t_id = t["task"]
            clean_exs = []
            for idx, ex in enumerate(t["exercises"], start=1):
                ov = overrides.get((u, t_id, idx), {})
                sentence1 = ov.get("sentence1", ex["sentence1"]).strip()
                part1 = ov.get("part1", ex["part1"]).strip()
                part2 = ov.get("part2", ex["part2"]).strip()
                key_word = ov.get("key_word", ex["key_word"]).strip().upper()
                primary_ans = ov.get("answer", ex["answer"]).strip()
                extra = ov.get("extra_answers", ex.get("extra_answers", []))

                accepted = expand_contractions_and_spelling(primary_ans)
                for ext in extra:
                    for v in expand_contractions_and_spelling(ext):
                        if v not in accepted:
                            accepted.append(v)

                valid_accepted = [a for a in accepted if 2 <= count_words(a) <= 5]
                if not valid_accepted:
                    raise ValueError(
                        f"Unit {u} Task {t_id} Ex {idx} has no valid 2-5 word answer: {accepted}"
                    )

                # Verify key_word is present in primary answer
                kw_lower = key_word.lower()
                ans_tokens = re.findall(r"[a-z]+", valid_accepted[0].lower())
                if kw_lower not in ans_tokens:
                    raise ValueError(
                        f"Unit {u} Task {t_id} Ex {idx}: keyWord '{key_word}' not in primary answer '{valid_accepted[0]}'"
                    )

                clean_exs.append(
                    {
                        "sentence1": sentence1,
                        "part1": part1,
                        "part2": part2,
                        "keyWord": key_word,
                        "answer": valid_accepted[0],
                        "acceptedAnswers": valid_accepted,
                    }
                )
            clean_tasks.append(
                {
                    "taskId": t_id,
                    "level": t["level"],
                    "exercises": clean_exs,
                }
            )
        sanitized_units[u] = clean_tasks

    return sanitized_units


def sanitize_word_formation_units() -> dict[int, list]:
    """Extract and sanitize Word Formation Units 1-4."""
    units = {}
    for u in range(1, 5):
        raw_tasks = extract_js_tasks_from_html(find_source_html(f"word_formation_u{u}.html"))
        units[u] = raw_tasks

    wf_overrides = {
        # UNIT 1
        (1, 1, 1): {
            "sentence": "The sheer amount of human suffering caused by the conflict is almost beyond {gap}.",
            "hint": "COMPREHEND",
            "answer": "comprehension",
        },
        (1, 1, 6): {
            "sentence": "The documentary provides a clear {gap} of the historical events.",
            "hint": "CLARIFY",
            "answer": "clarification",
        },
        (1, 3, 6): {
            "hint": "EVIDENCE",
            "answer": "evident",
        },
        (1, 3, 7): {
            "sentence": "The process of leaving the EU required a major {gap} in the political system.",
            "hint": "TRANSFORM",
            "answer": "transformation",
        },
        (1, 4, 1): {
            "hint": "VULNERABILITY",
            "answer": "vulnerable",
        },
        (1, 4, 5): {
            "hint": "PASSIONATE",
            "answer": "passion",
        },
        (1, 6, 3): {
            "hint": "RADICALISM",
            "answer": "radical",
        },
        (1, 7, 3): {
            "sentence": "The proposal caused a deep {gap} among the committee members.",
            "hint": "DIVIDE",
            "answer": "division",
        },
        (1, 9, 2): {
            "hint": "FORESEE",
            "answer": "foresight",
        },
        (1, 10, 1): {
            "sentence": "The old house slowly crumbled away due to years of poor {gap} and neglect.",
            "hint": "MAINTAIN",
            "answer": "maintenance",
        },
        (1, 10, 6): {
            "sentence": "The government is conducting a {gap} survey to determine the exact population.",
            "hint": "NATION",
            "answer": "national",
            "extra_answers": ["nationwide"],
        },

        # UNIT 2
        (2, 1, 2): {
            "sentence": "We must ensure that the new system runs as {gap} as possible.",
            "hint": "SMOOTH",
            "answer": "smoothly",
        },
        (2, 2, 2): {
            "hint": "DESCRIBE",
            "answer": "description",
        },
        (2, 4, 2): {
            "hint": "SIGHT",
            "answer": "insight",
        },
        (2, 4, 7): {
            "sentence": "The country is undergoing a major {gap} from dictatorship to democracy.",
            "hint": "TRANSFORM",
            "answer": "transformation",
        },
        (2, 6, 6): {
            "hint": "COMMERCE",
            "answer": "commercial",
        },
        (2, 7, 4): {
            "hint": "RESOLVE",
            "answer": "resolution",
            "extra_answers": ["resoluteness"],
        },
        (2, 7, 6): {
            "sentence": "He managed to pass the demanding physical test seemingly {gap}.",
            "hint": "EFFORT",
            "answer": "effortlessly",
        },
        (2, 8, 4): {
            "sentence": "The new CEO quickly brought about a major {gap} in the company's philosophy.",
            "hint": "TRANSFORM",
            "answer": "transformation",
        },
        (2, 10, 1): {
            "sentence": "The two sides signed a formal agreement of full {gap} in the investigation.",
            "hint": "COOPERATE",
            "answer": "cooperation",
        },
        (2, 10, 3): {
            "sentence": "The fragile ancient manuscripts had to be handled very {gap} by the archivists.",
            "hint": "CARE",
            "answer": "carefully",
        },

        # UNIT 3
        (3, 2, 4): {
            "sentence": "The children were tired but in good spirits after the {gap} hike through the mountains.",
            "hint": "EXHAUST",
            "answer": "exhausting",
        },
        (3, 2, 7): {
            "hint": "RESOLVE",
            "answer": "resolution",
            "extra_answers": ["resoluteness"],
        },
        (3, 4, 5): {
            "sentence": "The university checks the {gap} of all certificates before granting admission.",
            "hint": "VALID",
            "answer": "validity",
        },
        (3, 4, 6): {
            "sentence": "The documentary provided much food for thought regarding the future of {gap} energy.",
            "hint": "RENEW",
            "answer": "renewable",
        },
        (3, 5, 1): {
            "sentence": "She officially announced her {gap} for the upcoming presidential election.",
            "hint": "CANDIDATE",
            "answer": "candidacy",
            "extra_answers": ["candidature"],
        },
        (3, 9, 7): {
            "sentence": "The author has compiled a {gap} report covering every single detail of the case.",
            "hint": "VOLUME",
            "answer": "voluminous",
        },
        (3, 10, 6): {
            "sentence": "The two witnesses gave completely {gap} accounts of what happened that night.",
            "hint": "CONFLICT",
            "answer": "conflicting",
        },

        # UNIT 4
        (4, 3, 4): {
            "sentence": "The film offers a deeply {gap} look into the life of an intelligence officer.",
            "hint": "INSIGHT",
            "answer": "insightful",
        },
        (4, 4, 2): {
            "sentence": "The {gap} of the committee members voted in favour of the environmental proposal.",
            "hint": "MAJOR",
            "answer": "majority",
        },
        (4, 4, 6): {
            "sentence": "The young intern was too {gap} to handle the complex negotiations alone.",
            "hint": "EXPERIENCE",
            "answer": "inexperienced",
        },
        (4, 7, 6): {
            "sentence": "The patient remained in a {gap} condition for several days after the accident.",
            "hint": "CRISIS",
            "answer": "critical",
        },
        (4, 7, 7): {
            "hint": "ENTHUSIASM",
            "answer": "enthusiastic",
        },
        (4, 9, 6): {
            "sentence": "The results of the second experiment were roughly {gap} to those of the first.",
            "hint": "COMPARE",
            "answer": "comparable",
        },
    }

    sanitized_units = {}
    for u, raw_tasks in units.items():
        clean_tasks = []
        for t in raw_tasks:
            t_id = t["task"]
            clean_exs = []
            for idx, ex in enumerate(t["exercises"], start=1):
                ov = wf_overrides.get((u, t_id, idx), {})
                sentence = ov.get("sentence", ex["sentence"]).strip()
                hint = ov.get("hint", ex["hint"]).strip().upper()
                primary_ans = ov.get("answer", ex["answer"]).strip()
                extra = ov.get("extra_answers", ex.get("extra_answers", []))

                if "{gap}" not in sentence:
                    raise ValueError(f"Missing {{gap}} in WF Unit {u} Task {t_id} Ex {idx}: {sentence}")

                if hint.lower() == primary_ans.lower():
                    raise ValueError(
                        f"WF Unit {u} Task {t_id} Ex {idx}: hint '{hint}' is identical to answer '{primary_ans}'"
                    )

                accepted = expand_contractions_and_spelling(primary_ans)
                for ext in extra:
                    for v in expand_contractions_and_spelling(ext):
                        if v not in accepted:
                            accepted.append(v)

                clean_exs.append(
                    {
                        "sentence": sentence,
                        "hint": hint,
                        "baseWord": hint,
                        "answer": accepted[0],
                        "acceptedAnswers": accepted,
                    }
                )
            clean_tasks.append(
                {
                    "taskId": t_id,
                    "level": t["level"],
                    "exercises": clean_exs,
                }
            )
        sanitized_units[u] = clean_tasks

    return sanitized_units


def build_kw_topic_json(unit_num: int, tasks: list) -> dict:
    topic_id = f"key-word-u{unit_num}"
    unit_subtitles = {
        1: "Core Grammar, Conditionals, Passives & Phrasal Expressions",
        2: "Tenses, Modals, Inversion & Cleft Structures",
        3: "Reported Speech, Causatives, Subjunctive & Idioms",
        4: "Advanced B2/C1 Register, Collocations & Complex Syntax",
    }
    normalized_exercises = []
    for t in tasks:
        t_id = t["taskId"]
        sentences = []
        for idx, ex in enumerate(t["exercises"], start=1):
            p1 = ex["part1"]
            p2 = ex["part2"]
            text_with_slot = f"{p1} {{{{0}}}} {p2}".strip()
            sentences.append(
                {
                    "id": f"kw-u{unit_num}-t{t_id}-s{idx}",
                    "lead": ex["sentence1"],
                    "sentence1": ex["sentence1"],
                    "part1": p1,
                    "part2": p2,
                    "keyWord": ex["keyWord"],
                    "text": text_with_slot,
                    "gaps": [
                        {
                            "id": "g1",
                            "prompt": f"KEY WORD: {ex['keyWord']}",
                            "keyWord": ex["keyWord"],
                            "answer": ex["answer"],
                            "solutions": ex["acceptedAnswers"],
                            "acceptedAnswers": ex["acceptedAnswers"],
                            "hint": f"Use '{ex['keyWord']}' unmodified (2 to 5 words).",
                            "explanation": f"Target transformation: '{ex['answer']}'",
                        }
                    ],
                }
            )
        normalized_exercises.append(
            {
                "id": f"ex-kw-u{unit_num}-t{t_id}",
                "title": f"Task {t_id}: {t['level']}",
                "type": "key-word-transformation",
                "instruction": "Complete the second sentence so that it has a similar meaning to the first sentence, using the word given. Do not change the word given. You must use between two and five words, including the word given.",
                "sentences": sentences,
            }
        )

    return {
        "id": topic_id,
        "title": f"Key-Word Transformation – Unit {unit_num}",
        "subtitle": unit_subtitles[unit_num],
        "category": "Use of English & Grammar",
        "level": "B2 / Abschlussklasse",
        "grade": "key-word",
        "format": "key-word",
        "accentColor": "rose",
        "icon": "🔑",
        "description": f"Cambridge B2 First (FCE) & Abschlussprüfung Key-Word Transformations – Unit {unit_num}: {unit_subtitles[unit_num]}.",
        "instructions": "Complete the second sentence so that it has a similar meaning to the first sentence, using the word given. Do not change the word given. You must use between TWO and FIVE words, including the word given.",
        "rules": {
            "title": f"Key-Word Transformation – Unit {unit_num} (Cambridge B2 Standard)",
            "summary": "Forme den zweiten Satz so um, dass er dieselbe Bedeutung wie der erste Satz hat. Verwende dabei das vorgegebene Schlüsselwort (KEY WORD) unverändert in 2 bis 5 Wörtern.",
            "sections": [
                {
                    "heading": "Goldene Regeln (Cambridge B2 Standard)",
                    "Giveaway": "2 bis 5 Wörter inklusive KEY WORD",
                    "items": [
                        "Verwende zwingend zwischen **2 und 5 Wörtern** (inklusive des vorgegebenen Key Words).",
                        "Das **KEY WORD** darf in seiner Form **nicht verändert** werden.",
                        "Kontraktionen (z. B. *wasn't*, *didn't*, *I'd*) sowie ausgeschriebene Formen (*was not*, *did not*) und UK/US-Schreibweisen (*organising* / *organizing*) werden gleichermaßen akzeptiert.",
                    ],
                },
                {
                    "heading": "Typische Transformationsmuster",
                    "items": [
                        "**Aktiv ↔ Passiv / Causative**: *have something done*, *is believed to have...*",
                        "**Conditionals & Wishes**: *If only I had...*, *had it not been for...*, *unless...*",
                        "**Inversion & Emphasis**: *Never before had...*, *Little did they know...*, *Only by...*",
                        "**Fixed Phrases & Phrasal Verbs**: *put up with*, *cut down on*, *come to terms with*",
                    ],
                },
            ],
        },
        "tasks": tasks,
        "exercises": normalized_exercises,
    }


def build_wf_topic_json(unit_num: int, tasks: list) -> dict:
    topic_id = f"word-formation-u{unit_num}"
    unit_subtitles = {
        1: "Prefixes, Suffixes & High-Frequency Word Families",
        2: "Abstract Nouns, Negative Prefixes & Adverbials",
        3: "Academic Vocabulary, Compounding & Internal Stem Changes",
        4: "Advanced B2/C1 Derivatives & Exam-Level Contexts",
    }
    normalized_exercises = []
    for t in tasks:
        t_id = t["taskId"]
        sentences = []
        for idx, ex in enumerate(t["exercises"], start=1):
            text_with_slot = ex["sentence"].replace("{gap}", "{{0}}")
            sentences.append(
                {
                    "id": f"wf-u{unit_num}-t{t_id}-s{idx}",
                    "sentence": ex["sentence"],
                    "hint": ex["hint"],
                    "baseWord": ex["baseWord"],
                    "text": text_with_slot,
                    "gaps": [
                        {
                            "id": "g1",
                            "prompt": ex["baseWord"],
                            "baseWord": ex["baseWord"],
                            "hint": ex["hint"],
                            "answer": ex["answer"],
                            "solutions": ex["acceptedAnswers"],
                            "acceptedAnswers": ex["acceptedAnswers"],
                            "explanation": f"Base word: {ex['baseWord']} → {ex['answer']}",
                        }
                    ],
                }
            )
        normalized_exercises.append(
            {
                "id": f"ex-wf-u{unit_num}-t{t_id}",
                "title": f"Task {t_id}: {t['level']}",
                "type": "word-formation",
                "instruction": "Use the word given in capitals for each gap to form a word that fits in the space in the same line.",
                "sentences": sentences,
            }
        )

    return {
        "id": topic_id,
        "title": f"Word Formation – Unit {unit_num}",
        "subtitle": unit_subtitles[unit_num],
        "category": "Vocabulary & Word Building",
        "level": "B2 / Abschlussklasse",
        "grade": "word-formation",
        "format": "word-formation",
        "accentColor": "violet",
        "icon": "🧩",
        "description": f"Cambridge B2 First (FCE) & Abschlussprüfung Word Formation – Unit {unit_num}: {unit_subtitles[unit_num]}.",
        "instructions": "Use the word given in capitals to form a word that fits grammatically and lexically into the gap in the sentence.",
        "rules": {
            "title": f"Word Formation – Unit {unit_num} (B2 / Exam Prep)",
            "summary": "Bilde aus dem in Großbuchstaben angegebenen Stammwort (BASE WORD) die grammatikalisch und inhaltlich passende Wortform (Nomen, Verb, Adjektiv oder Adverb).",
            "sections": [
                {
                    "heading": "Strategie zur Wortbildung",
                    "items": [
                        "**1. Wortart bestimmen**: Braucht die Lücke ein Nomen (*-tion, -ment, -ness, -ity*), ein Adjektiv (*-able, -ive, -ous, -ful*), ein Adverb (*-ly*) oder ein Verb (*en-, -ify, -ise/-ize*)?",
                        "**2. Negativpräfixe prüfen**: Verlangt der Satzkontext ein negatives Präfix (*un-, in-, im-, il-, ir-, dis-, mis-*)?",
                        "**3. Plural / Zeitform beachten**: Bei zählbaren Nomen prüfen, ob Singular oder Plural benötigt wird.",
                    ],
                }
            ],
        },
        "tasks": tasks,
        "exercises": normalized_exercises,
    }


def build_reading_memory_games_json():
    sections = [
        {
            "id": 1,
            "marker": "[1]",
            "content": "Most people have trouble remembering where they put their car keys, or if they turned their oven off. And yet an astonishing few can memorize entire decks of cards and long strings of random numbers. The documentary Memory Games offers a fascinating glimpse into the lives of these mind athletes as they compete for the title of World Memory Champion. The Post spoke with Nelson Cowan, a cognitive psychologist at the University of Missouri and two competitors profiled in the film – International Grandmaster of Memory Yanjaa Wintersoul, 30, and four-time USA Champion Nathan Dellis, 39 – for tips on how regular folks can improve their daily recall.",
            "html": "Most people have trouble remembering where they put their car keys, or if they turned their oven off. And yet an astonishing few can memorize entire decks of cards and long strings of random numbers. The documentary <em>Memory Games</em> offers a fascinating glimpse into the lives of these mind athletes as they compete for the title of World Memory Champion. The Post spoke with Nelson Cowan, a cognitive psychologist at the University of Missouri and two competitors profiled in the film – International Grandmaster of Memory Yanjaa Wintersoul, 30, and four-time USA Champion Nathan Dellis, 39 – for tips on how regular folks can improve their daily recall.",
        },
        {
            "id": 2,
            "marker": "[2]",
            "content": "In high school Yanjaa Wintersoul would never have imagined that she would one day gain recognition for having one of the best memories in the world. She explains: “I almost didn’t graduate because I didn’t know how to make my knowledge of physics and chemistry stick. The moment when everything changed for me was several years later when I happened to pick up Joshua Foer’s bestseller on brain techniques. It delves into the science of what makes the human brain tick and helps ordinary people strengthen their memories. It was a revelation for me. I began using memorization rules while studying for my business degree in Stockholm and I finished in just two years.”",
            "html": "In high school Yanjaa Wintersoul would never have imagined that she would one day gain recognition for having one of the best memories in the world. She explains: “I almost didn’t graduate because I didn’t know how to make my knowledge of physics and chemistry stick. The moment when everything changed for me was several years later when I happened to pick up Joshua Foer’s bestseller on brain techniques. It delves into the science of what makes the human brain tick and helps ordinary people strengthen their memories. It was a revelation for me. I began using memorization rules while studying for my business degree in Stockholm and I finished in just two years.”",
        },
        {
            "id": 3,
            "marker": "[3]",
            "content": "Nelson Cowan, who does research on how the brain works, says: “It’s not like each memory takes a neuron and then that cell is used up. Imagine you experience a situation or get some information. Your brain first keeps them short-term in a system known as ‘working memory’. Later, if the information stays relevant, our brain encodes it in specific combinations of neurons; the memory becomes long-term.” Our brain can do that an infinite amount of times. From a scientific point of view, the number of facts stored in those patterns is also endless. “If you fill up your 128-gigabyte phone with images, you run out of storage capacity. Our brain doesn’t work like that. The more ‘pictures you take’ and the more you try to remember, the more you will remember,” Cowan adds.",
            "html": "Nelson Cowan, who does research on how the brain works, says: “It’s not like each memory takes a neuron and then that cell is used up. Imagine you experience a situation or get some information. Your brain first keeps them short-term in a system known as ‘working memory’. Later, if the information stays relevant, our brain encodes it in specific combinations of neurons; the memory becomes long-term.” Our brain can do that an infinite amount of times. From a scientific point of view, the number of facts stored in those patterns is also endless. “If you fill up your 128-gigabyte phone with images, you run out of storage capacity. Our brain doesn’t work like that. The more ‘pictures you take’ and the more you try to remember, the more you will remember,” Cowan adds.",
        },
        {
            "id": 4,
            "marker": "[4]",
            "content": "While Yanjaa Wintersoul began competing when barely out of her teens, Nathan Dellis came to the sport a little later in life. “I started listening to people more actively when they were talking about things,” he explains. “Being mindful and paying attention are key to processing the information effectively. There’s plenty of useful daily information worth remembering, which many forget. Every person you meet, try to memorize their name,” advises Dellis. Challenging your brain on a permanent basis will likely yield amazing results. For instance, he has made a habit of memorizing license plate numbers when stuck in the rush hour. Enough shut-eye is also essential.",
            "html": "While Yanjaa Wintersoul began competing when barely out of her teens, Nathan Dellis came to the sport a little later in life. “I started listening to people more actively when they were talking about things,” he explains. “Being mindful and paying attention are key to processing the information effectively. There’s plenty of useful daily information worth remembering, which many forget. Every person you meet, try to memorize their name,” advises Dellis. Challenging your brain on a permanent basis will likely yield amazing results. For instance, he has made a habit of memorizing license plate numbers when stuck in the rush hour. Enough shut-eye is also essential.",
        },
        {
            "id": 5,
            "marker": "[5]",
            "content": "Dellis, for example, attempts to get at least eight hours per night. When Wintersoul began making a name for herself in the world of competitions, reality shows also began calling. One day, a furniture giant wanted to hire her for an advertisement. They originally asked if she could remember their dining room collection in a week. “I said, ‘I think it would be fun if I learned your entire catalogue by heart.’ And I did, committing 328 pages to memory. Although I can’t recall every single item a year later, I do remember a good deal of it, particularly the pages featuring picture-perfect family scenes.",
            "html": "Dellis, for example, attempts to get at least eight hours per night. When Wintersoul began making a name for herself in the world of competitions, reality shows also began calling. One day, a furniture giant wanted to hire her for an advertisement. They originally asked if she could remember their dining room collection in a week. “I said, ‘I think it would be fun if I learned your entire catalogue by heart.’ And I did, committing 328 pages to memory. Although I can’t recall every single item a year later, I do remember a good deal of it, particularly the pages featuring picture-perfect family scenes.",
        },
        {
            "id": 6,
            "marker": "[6]",
            "content": "Such emotions stick best with me. I think that’s the key to everybody’s memory, you have to make things truly matter to yourself.” Cowan confirms that memories depend on specific contexts. In a renowned study, participants who learned lists while scuba diving had better recall when they were underwater than when they were on land. Underwater or not – want to stop the did-I-remember-to-turn-off-the-oven paranoia, or at least get a better handle on people’s names? Keep at it! Even if you aren’t born with remarkable talent, with the right strategies, you can become a memory champion too.",
            "html": "Such emotions stick best with me. I think that’s the key to everybody’s memory, you have to make things truly matter to yourself.” Cowan confirms that memories depend on specific contexts. In a renowned study, participants who learned lists while scuba diving had better recall when they were underwater than when they were on land. Underwater or not – want to stop the did-I-remember-to-turn-off-the-oven paranoia, or at least get a better handle on people’s names? Keep at it! Even if you aren’t born with remarkable talent, with the right strategies, you can become a memory champion too.",
        },
    ]

    task1_matching = {
        "title": "Task 1: Matching Expressions (A-F with 0-7)",
        "instruction": "Match the expressions (A – F) as used in the text with their corresponding definitions (0 – 7). Be careful: There are two definitions that you do not need.",
        "expressions": [
            {
                "id": "A",
                "label": "A. astonishing few [Sec 1]",
                "shortLabel": "A. astonishing few",
                "section": 1,
                "answer": 3,
                "acceptedAnswers": ["3"],
            },
            {
                "id": "B",
                "label": "B. gain recognition [Sec 2]",
                "shortLabel": "B. gain recognition",
                "section": 2,
                "answer": 1,
                "acceptedAnswers": ["1"],
            },
            {
                "id": "C",
                "label": "C. make my knowledge stick [Sec 2]",
                "shortLabel": "C. make my knowledge stick",
                "section": 2,
                "answer": 2,
                "acceptedAnswers": ["2"],
            },
            {
                "id": "D",
                "label": "D. brain tick [Sec 2]",
                "shortLabel": "D. brain tick",
                "section": 2,
                "answer": 5,
                "acceptedAnswers": ["5"],
            },
            {
                "id": "E",
                "label": "E. on a permanent basis [Sec 4]",
                "shortLabel": "E. on a permanent basis",
                "section": 4,
                "answer": 6,
                "acceptedAnswers": ["6"],
            },
            {
                "id": "F",
                "label": "F. shut-eye [Sec 4]",
                "shortLabel": "F. shut-eye",
                "section": 4,
                "answer": 4,
                "acceptedAnswers": ["4"],
            },
        ],
        "definitions": [
            {
                "number": 0,
                "text": "to find an object after a long search.",
                "isDistractor": True,
                "note": "Do not need",
            },
            {
                "number": 1,
                "text": "to become publicly acknowledged for an achievement.",
                "isDistractor": False,
                "matchedBy": "B",
            },
            {
                "number": 2,
                "text": "to be understood or retained in memory.",
                "isDistractor": False,
                "matchedBy": "C",
            },
            {
                "number": 3,
                "text": "a surprisingly small number of people.",
                "isDistractor": False,
                "matchedBy": "A",
            },
            {
                "number": 4,
                "text": "sleep.",
                "isDistractor": False,
                "matchedBy": "F",
            },
            {
                "number": 5,
                "text": "to understand how the brain functions.",
                "isDistractor": False,
                "matchedBy": "D",
            },
            {
                "number": 6,
                "text": "continually or constantly.",
                "isDistractor": False,
                "matchedBy": "E",
            },
            {
                "number": 7,
                "text": "to remember something perfectly.",
                "isDistractor": True,
                "note": "Do not need",
            },
        ],
        "solution_mapping": {
            "A": 3,
            "B": 1,
            "C": 2,
            "D": 5,
            "E": 6,
            "F": 4,
        },
        "distractors": [0, 7],
    }

    task2_vocabulary = {
        "title": "Task 2: Find a Word or Expression",
        "instruction": "Find a word or expression in the text that means the same as each of the following words (1 – 5). The section where the word is located is indicated.",
        "items": [
            {
                "id": 1,
                "prompt": "1. remembering (noun) [Section 1]",
                "target": "remembering (noun)",
                "context": "[Section 1]",
                "section": 1,
                "answer": "recall",
                "acceptedAnswers": ["recall", "daily recall"],
            },
            {
                "id": 2,
                "prompt": "2. understand how it functions (verb) [Section 2]",
                "target": "understand how it functions (verb)",
                "context": "[Section 2]",
                "section": 2,
                "answer": "tick",
                "acceptedAnswers": ["tick", "to tick"],
            },
            {
                "id": 3,
                "prompt": "3. limitless (adj) [Section 3]",
                "target": "limitless (adj)",
                "context": "[Section 3]",
                "section": 3,
                "answer": "infinite",
                "acceptedAnswers": ["infinite", "endless"],
            },
            {
                "id": 4,
                "prompt": "4. very good, talented (adj) [Section 6]",
                "target": "very good, talented (adj)",
                "context": "[Section 6]",
                "section": 6,
                "answer": "remarkable",
                "acceptedAnswers": ["remarkable"],
            },
            {
                "id": 5,
                "prompt": "5. to be committed to (verb gerund form) [Section 5]",
                "target": "to be committed to (verb gerund form)",
                "context": "[Section 5]",
                "section": 5,
                "answer": "committing",
                "acceptedAnswers": ["committing", "committing to memory"],
            },
        ],
    }

    # Build sentences array for engine & audit compatibility (6 matching + 5 vocabulary = 11 items)
    compat_sentences = []
    for expr in task1_matching["expressions"]:
        sol_num = str(expr["answer"])
        compat_sentences.append(
            {
                "id": f"t1_{expr['id']}",
                "sentence": f"{expr['label']} → Definition {{gap}}",
                "text": f"{expr['label']} → Definition {{{{0}}}}",
                "gaps": [
                    {
                        "id": f"match_{expr['id']}",
                        "prompt": expr["label"],
                        "answer": sol_num,
                        "acceptedAnswers": [sol_num],
                        "solutions": [sol_num],
                        "explanation": f"Korrekte Zuordnung für {expr['shortLabel']}: Nummer {sol_num}",
                    }
                ],
            }
        )
    for item in task2_vocabulary["items"]:
        compat_sentences.append(
            {
                "id": f"t2_{item['id']}",
                "sentence": f"{item['prompt']}: {{gap}}",
                "text": f"{item['prompt']}: {{{{0}}}}",
                "gaps": [
                    {
                        "id": f"syn_{item['id']}",
                        "prompt": item["prompt"],
                        "answer": item["answer"],
                        "acceptedAnswers": item["acceptedAnswers"],
                        "solutions": item["acceptedAnswers"],
                        "explanation": f"Gesuchtes Wort im Text ({item['context']}): {item['answer']}",
                    }
                ],
            }
        )

    return {
        "id": "reading-memory-games",
        "title": "Reading Comprehension: Memory Games",
        "category": "Reading Comprehension",
        "level": "B2 / Abschlussklasse",
        "grade": "reading-comprehension",
        "format": "reading-comprehension",
        "type": "reading-comprehension",
        "accentColor": "emerald",
        "icon": "📖",
        "description": "Interactive B2 Reading Comprehension ('Memory Games'): Matching Expressions (A–F with 0–7) & Finding Synonyms in Context (1–5).",
        "instructions": "Read the article 'Memory Games' ([1]–[6]) and complete Task 1 (Matching Expressions A–F) and Task 2 (Find a Word or Expression 1–5).",
        "rules": {
            "title": "Reading Comprehension Strategy (B2 Exam Prep)",
            "summary": "Lies zuerst den jeweiligen Abschnitt ([1]–[6]), auf den die Aufgabe verweist, und prüfe den genauen Satzkontext sowie die geforderte Wortart.",
            "sections": [
                {
                    "heading": "Strategie für Task 1 & Task 2",
                    "items": [
                        "**1. Task 1 (Matching Expressions A–F)**: Suche den Ausdruck im angegebenen Paragraphen (`[Sec 1]`–`[Sec 4]`) und gleiche die Bedeutung im Kontext mit den Definitionen `0–7` ab (Achtung: 2 Distraktoren werden nicht benötigt).",
                        "**2. Task 2 (Find a Word or Expression 1–5)**: Achte strikt auf die geforderte Wortart in Klammern (*noun, verb, adj, verb gerund form*) und übernimm das Wort exakt aus dem angegebenen Abschnitt.",
                    ],
                }
            ],
        },
        "text": {
            "title": "Memory Games",
            "sections": sections,
        },
        "task1_matching": task1_matching,
        "task2_vocabulary": task2_vocabulary,
        "exercises": [
            {
                "id": "reading-memory-games-main",
                "title": "Memory Games – Task 1 (Matching) & Task 2 (Vocabulary)",
                "type": "reading_comprehension",
                "instruction": "Read the text 'Memory Games' ([1]–[6]) and complete Task 1 (Matching Expressions A–F with 0–7) and Task 2 (Find a Word or Expression 1–5).",
                "sentences": compat_sentences,
            }
        ],
    }


def update_topics_catalog():
    catalog_path = ROOT / "data" / "topics-catalog.json"

    grades = [
        {
            "id": "word-formation",
            "grade": "word-formation",
            "label": "Word Formation",
            "icon": "🧩",
            "subtitle": "Vocabulary & Word Building · B2 / Abschlussklasse (Units 1–4 · 280 Items)",
            "accentColor": "violet",
        },
        {
            "id": "key-word",
            "grade": "key-word",
            "label": "Key-Word Transformation",
            "icon": "🔑",
            "subtitle": "Use of English & Grammar · Cambridge B2 Standard (Units 1–4 · 200 Transformations)",
            "accentColor": "rose",
        },
        {
            "id": "reading-comprehension",
            "grade": "reading-comprehension",
            "label": "Reading Comprehension",
            "icon": "📖",
            "subtitle": "B2 Reading & Vocabulary in Context · Text Analysis, Matching & Synonym Finding (5 Units · 55 Items)",
            "accentColor": "emerald",
        },
    ]

    wf_descriptions = {
        1: "Prefixes, Suffixes & High-Frequency Word Families (10 Tasks · 70 Items).",
        2: "Abstract Nouns, Negative Prefixes & Adverbials (10 Tasks · 70 Items).",
        3: "Academic Vocabulary, Compounding & Internal Stem Changes (10 Tasks · 70 Items).",
        4: "Advanced B2/C1 Derivatives & Exam-Level Contexts (10 Tasks · 70 Items).",
    }
    kw_descriptions = {
        1: "Core Grammar, Conditionals, Passives & Phrasal Expressions (10 Tasks · 50 Transformations).",
        2: "Tenses, Modals, Inversion & Cleft Structures (10 Tasks · 50 Transformations).",
        3: "Reported Speech, Causatives, Subjunctive & Idioms (10 Tasks · 50 Transformations).",
        4: "Advanced B2/C1 Register, Collocations & Complex Syntax (10 Tasks · 50 Transformations).",
    }

    b2_entries = []
    for u in range(1, 5):
        b2_entries.append(
            {
                "id": f"word-formation-u{u}",
                "title": f"Word Formation – Unit {u}",
                "grade": "word-formation",
                "format": "word-formation",
                "level": "B2 / Abschlussklasse",
                "category": "Vocabulary & Word Building",
                "icon": "🧩",
                "accentColor": "violet",
                "description": wf_descriptions[u],
                "exerciseCount": 10,
                "legacyMasteryKey": f"uoe_wf_u{u}_mastered",
                "legacyMasteredKey": f"uoe_wf_u{u}_mastered",
                "hasJson": True,
                "isExamPrep": True,
            }
        )
    for u in range(1, 5):
        b2_entries.append(
            {
                "id": f"key-word-u{u}",
                "title": f"Key-Word Transformation – Unit {u}",
                "grade": "key-word",
                "format": "key-word",
                "level": "B2 / Abschlussklasse",
                "category": "Use of English & Grammar",
                "icon": "🔑",
                "accentColor": "rose",
                "description": kw_descriptions[u],
                "exerciseCount": 10,
                "legacyMasteryKey": f"uoe_kw_u{u}_mastered",
                "legacyMasteredKey": f"uoe_kw_u{u}_mastered",
                "hasJson": True,
                "isExamPrep": True,
            }
        )

    preferred_reading_order = [
        "reading-memory-games.json",
        "reading-artificial-intelligence.json",
        "reading-extreme-sports.json",
        "reading-urban-farming.json",
        "reading-ocean-exploration.json",
    ]
    reading_files = sorted(
        TOPICS_DIR.glob("reading-*.json"),
        key=lambda p: (
            preferred_reading_order.index(p.name)
            if p.name in preferred_reading_order
            else len(preferred_reading_order),
            p.name,
        ),
    )
    for r_path in reading_files:
        try:
            r_data = json.loads(r_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        r_id = r_data.get("id") or r_path.stem
        r_title = r_data.get("title") or f"Reading Comprehension: {r_id}"
        t_title = (r_data.get("text") or {}).get("title") or r_title.replace("Reading Comprehension: ", "")
        sec_cnt = len((r_data.get("text") or {}).get("sections") or []) or 6
        r_desc = (
            r_data.get("description")
            or f"Article '{t_title}' ([1]–[{sec_cnt}]) · Task 1: Matching Expressions (A–F with 0–7) & Task 2: Find a Word or Expression (1–5)."
        )
        m_key = f"uoe_{r_id.replace('-', '_')}_mastered"
        b2_entries.append(
            {
                "id": r_id,
                "title": r_title,
                "grade": "reading-comprehension",
                "format": "reading-comprehension",
                "level": r_data.get("level") or "B2 / Abschlussklasse",
                "category": "Reading Comprehension",
                "icon": r_data.get("icon") or "📖",
                "accentColor": r_data.get("accentColor") or "emerald",
                "description": r_desc,
                "exerciseCount": 2,
                "legacyMasteryKey": m_key,
                "legacyMasteredKey": m_key,
                "hasJson": True,
                "isExamPrep": True,
            }
        )

    catalog = {
        "project": "Use of English",
        "subtitle": "Use of English – Exam Prep & Skills (B2 Abschlussprüfung)",
        "version": "2.0.0",
        "grades": grades,
        "topics": b2_entries,
    }
    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Updated {catalog_path.name} with {len(b2_entries)} Use of English (B2) units (WF, KW & Reading)")


def update_index_html():
    index_path = ROOT / "index.html"
    catalog_path = ROOT / "data" / "topics-catalog.json"
    if not index_path.exists() or not catalog_path.exists():
        return

    import html as html_mod

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    html_text = index_path.read_text(encoding="utf-8")

    # 1. Rebrand <title>, header brand, hero section, search placeholder, footer
    html_text = re.sub(
        r"<title>.*?</title>",
        "<title>Use of English · Exam Prep &amp; Skills (B2 Abschlussprüfung)</title>",
        html_text,
        flags=re.S,
    )

    html_text = re.sub(
        r'<a href="index\.html" class="gm-brand-link">.*?</a>',
        """<a href="index.html" class="gm-brand-link">
        <span aria-hidden="true">🎯</span>
        <span>Use of English</span>
      </a>""",
        html_text,
        flags=re.S,
    )

    hero_html = """    <!-- HERO SECTION -->
    <section class="gm-hub-hero">
      <div class="gm-school-badge">
        <span>Ignaz-Reder-Realschule</span>
        <span>•</span>
        <span>Klasse 10 / B2 Exam Prep</span>
      </div>
      <h1 class="gm-hub-title">
        Use of <span class="gm-text-gradient">English</span>
      </h1>
      <p class="gm-hub-subtitle">
        Use of English – Exam Prep &amp; Skills (B2 Abschlussprüfung) · Word Formation, Key-Word Transformation &amp; Reading Comprehension.
      </p>
    </section>"""

    html_text = re.sub(
        r"<!-- HERO SECTION -->.*?</section>",
        hero_html,
        html_text,
        flags=re.S,
    )

    # 2. Replace Grade Kacheln with the 3 Exam Format Kacheln (Word Formation, Key-Word Transformation, Reading Comprehension)
    kacheln_html = """      <div class="gm-grade-cards-grid" id="hub-grade-kacheln">
        <button type="button" class="gm-grade-kachel" data-grade="word-formation">
          <span class="gm-grade-kachel-icon">🧩</span>
          <div class="gm-grade-kachel-info">
            <div class="gm-grade-kachel-title">Word Formation</div>
            <div class="gm-grade-kachel-sub">Vocabulary &amp; Word Building (Units 1–4)</div>
          </div>
        </button>
        <button type="button" class="gm-grade-kachel" data-grade="key-word">
          <span class="gm-grade-kachel-icon">🔑</span>
          <div class="gm-grade-kachel-info">
            <div class="gm-grade-kachel-title">Key-Word Transformation</div>
            <div class="gm-grade-kachel-sub">Cambridge B2 Standard (Units 1–4)</div>
          </div>
        </button>
        <button type="button" class="gm-grade-kachel" data-grade="reading-comprehension">
          <span class="gm-grade-kachel-icon">📖</span>
          <div class="gm-grade-kachel-info">
            <div class="gm-grade-kachel-title">Reading Comprehension</div>
            <div class="gm-grade-kachel-sub">B2 Text Analysis &amp; Vocabulary in Context (5 Units)</div>
          </div>
        </button>
      </div>"""

    html_text = re.sub(
        r'<div class="gm-grade-cards-grid" id="hub-grade-kacheln">.*?</div>\s*</section>',
        kacheln_html + "\n    </section>",
        html_text,
        flags=re.S,
    )

    # 3. Replace Grade Filter Tabs with Format Filter Tabs:
    # [Alle Formate] [Word Formation] [Key-Word Transformation] [Reading Comprehension]
    tabs_html = """      <div class="gm-grade-tabs" id="hub-grade-tabs" role="tablist">
        <button type="button" class="gm-grade-tab is-active" data-grade="all">Alle Formate</button>
        <button type="button" class="gm-grade-tab" data-grade="word-formation">🧩 Word Formation</button>
        <button type="button" class="gm-grade-tab" data-grade="key-word">🔑 Key-Word Transformation</button>
        <button type="button" class="gm-grade-tab" data-grade="reading-comprehension">📖 Reading Comprehension</button>
      </div>"""

    html_text = re.sub(
        r'<div class="gm-grade-tabs" id="hub-grade-tabs" role="tablist">.*?</div>',
        tabs_html,
        html_text,
        flags=re.S,
    )

    html_text = html_text.replace(
        'placeholder="Thema suchen (z. B. If-Clauses, Passive)…"',
        'placeholder="Einheit suchen (z. B. Word Formation, Key-Word, Memory Games)..."',
    )
    html_text = html_text.replace(
        'Passe deinen Suchbegriff an oder wähle "Alle Stufen (5–10)".',
        'Passe deinen Suchbegriff an oder wähle "Alle Formate".',
    )

    # 4. Pre-render the 3 B2 sections (Word Formation, Key-Word Transformation, Reading Comprehension)
    sections_out = []
    topics = catalog.get("topics", [])
    for g in catalog.get("grades", []):
        g_id = g["grade"]
        g_items = [t for t in topics if str(t.get("grade")) == str(g_id)]
        if not g_items:
            continue
        cards = []
        for t in g_items:
            tid = html_mod.escape(t["id"])
            color = html_mod.escape(t.get("accentColor") or g.get("accentColor") or "violet")
            cat = html_mod.escape(t.get("category") or g.get("label") or "")
            lvl = html_mod.escape(t.get("level") or "B2 / Abschlussklasse")
            icon = t.get("icon") or "📘"
            title = html_mod.escape(t["title"])
            desc = html_mod.escape(t.get("description") or "")
            cnt = t.get("exerciseCount", 10)
            cards.append(
                f"""          <a href="exercise.html?topic={tid}" class="gm-topic-card" data-topic-id="{tid}" data-color="{color}">
            <div>
              <div class="gm-topic-card-top">
                <div class="gm-topic-badges">
                  <span class="gm-card-tag">{cat}</span>
                  <span class="gm-card-tag is-engine">{lvl}</span>
                </div>
                <span class="gm-topic-icon" aria-hidden="true">{icon}</span>
              </div>
              <h3 class="gm-topic-card-title">{title}</h3>
              <p class="gm-topic-card-desc">{desc}</p>
            </div>
            <div class="gm-topic-card-footer">
              <span>{cnt} Tasks · B2 Exam Prep</span>
              <span class="gm-topic-cta">Starten →</span>
            </div>
          </a>"""
            )
        sec_html = f"""      <section class="gm-grade-section" data-grade-section="{html_mod.escape(str(g_id))}">
        <div class="gm-grade-section-header">
          <h2 class="gm-grade-section-title"><span>{g.get("icon", "📘")}</span><span>{html_mod.escape(g.get("label", ""))}</span></h2>
          <span class="gm-grade-section-sub">{html_mod.escape(g.get("subtitle", ""))}</span>
        </div>
        <div class="gm-topics-grid">
{chr(10).join(cards)}
        </div>
      </section>"""
        sections_out.append(sec_html)

    main_block = (
        '<main id="hub-topics-root" aria-live="polite">\n'
        + "\n".join(sections_out)
        + "\n    </main>"
    )
    html_text = re.sub(
        r'<main id="hub-topics-root" aria-live="polite">.*?</main>(?:\s*<!-- VOCABULARY & STRATEGY COMPENDIUM.*?-->\s*<section class="gm-compendium-section".*?</section>)?',
        main_block,
        html_text,
        flags=re.S,
    )

    # Remove old external irregular verbs banner if present
    html_text = re.sub(
        r"<!-- IRREGULAR VERBS TRAINER BANNER -->.*?</a>",
        "",
        html_text,
        flags=re.S,
    )

    # Update footer branding
    html_text = html_text.replace(
        "&copy; 2026 Grammar Mastery · Ignaz-Reder-Realschule",
        "&copy; 2026 Use of English – Exam Prep &amp; Skills (B2 Abschlussprüfung) · Ignaz-Reder-Realschule",
    )

    # Clean up any compendium filter JS from index.html
    clean_mastered_js = """        var masteredEl = document.getElementById('hub-stat-mastered');
        if (masteredEl) masteredEl.textContent = String(masteredTotal);"""

    html_text = re.sub(
        r"var masteredEl = document\.getElementById\('hub-stat-mastered'\);\s*if \(masteredEl\) masteredEl\.textContent = String\(masteredTotal\);(?:\s*var compendiumEl = document\.getElementById\('hub-compendium-section'\);.*?return;\s*\} else \{.*?\}\s*\})?",
        clean_mastered_js,
        html_text,
        flags=re.S,
    )

    index_path.write_text(html_text, encoding="utf-8")
    print(f"[OK] Updated {index_path.name} with 'Use of English' 3-format dashboard (WF, KW, Reading)")


def main():
    TOPICS_DIR.mkdir(parents=True, exist_ok=True)

    kw_units = sanitize_key_word_units()
    for u, tasks in kw_units.items():
        data = build_kw_topic_json(u, tasks)
        out_path = TOPICS_DIR / f"key-word-u{u}.json"
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        total_items = sum(len(t["exercises"]) for t in tasks)
        print(f"[OK] Wrote {out_path.name} ({len(tasks)} tasks, {total_items} transformations)")

    wf_units = sanitize_word_formation_units()
    for u, tasks in wf_units.items():
        data = build_wf_topic_json(u, tasks)
        out_path = TOPICS_DIR / f"word-formation-u{u}.json"
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        total_items = sum(len(t["exercises"]) for t in tasks)
        print(f"[OK] Wrote {out_path.name} ({len(tasks)} tasks, {total_items} items)")

    reading_data = build_reading_memory_games_json()
    reading_path = TOPICS_DIR / "reading-memory-games.json"
    reading_path.write_text(json.dumps(reading_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Wrote {reading_path.name} (6 text sections, 6 matching items, 5 synonym items)")

    update_topics_catalog()
    update_index_html()


if __name__ == "__main__":
    main()
