import type { GrammarSeed } from "@/learning/grammar-seeds";

/**
 * The culture and pragmatics notes the curriculum teaches, one per slug.
 *
 * Same shape and same discipline as the grammar seeds — explanation in
 * English, examples and mistakes in German, the starred wrong form first —
 * because they live in the same catalogue table and ride the same teach flow.
 * What differs is the subject: not how a sentence is built but whether it
 * lands as intended — du or Sie, register, politeness, the unwritten rules.
 * Getting these wrong is not a grammar slip; it reads as rudeness or
 * distance, which is why the trainer teaches them on purpose rather than
 * waiting for a correction to come up.
 */
export const CULTURE_SEEDS: readonly GrammarSeed[] = [
  // --- A1 -------------------------------------------------------------
  {
    key: "du_oder_sie",
    explanation:
      "Sie with the surname is the default for adults you do not know — shops, offices, strangers on the street. du is for friends, family, children and fellow students. Getting this wrong is not a grammar mistake: du to a stranger reads as disrespect, Sie to a close friend as distance.",
    examples: [
      "Entschuldigung, können Sie mir helfen?",
      "Kommst du heute Abend mit?",
      "Wie heißen Sie, bitte?",
    ],
    mistakes: [
      "*Wie heißt du? — to an official at a counter → Wie heißen Sie? Strangers and officials get Sie.",
      "*Können Sie mir das Salz geben, Papa? → Kannst du mir das Salz geben? Family is du.",
    ],
    related: ["personal_pronouns_nominative"],
  },
  {
    key: "bitte_und_danke",
    explanation:
      "bitte does three jobs: please when you ask, here you are when you hand something over, and you are welcome after Danke. One more trap: a bare Danke in answer to an offer means no, thanks — accept with Ja, bitte or Gern.",
    examples: [
      "Einen Kaffee, bitte.",
      "Bitte schön! — Danke! — Bitte!",
      "Noch etwas Wasser? — Ja, bitte!",
    ],
    mistakes: [
      "*Noch Kaffee? — Danke! — when you wanted more → Ja, bitte. A bare Danke declines the offer.",
      "*Hier bitte, danke → Bitte schön. Handing something over takes bitte, not danke.",
    ],
    related: ["moechten_present"],
  },
  {
    key: "fremde_ansprechen",
    explanation:
      "Open with Entschuldigung and stay with Sie and the formal imperative when you stop a stranger — for directions, in a shop, on the platform. Hallo du or a bare imperative to someone you do not know reads as pushy rather than friendly.",
    examples: [
      "Entschuldigung, wo ist der Bahnhof?",
      "Entschuldigen Sie, ist hier noch frei?",
      "Sagen Sie mal, hält hier der Bus?",
    ],
    mistakes: [
      "*Hey, wo ist der Bahnhof? → Entschuldigung, wo ist der Bahnhof? Strangers are approached with an apology, not a hey.",
      "*Sag mal, wo ist die Haltestelle? — to a stranger → Sagen Sie mal. The formal imperative belongs with Sie.",
    ],
    related: ["imperative_formal", "du_oder_sie"],
  },
  {
    key: "wie_gehts_unter_freunden",
    explanation:
      "Unlike the English how are you, Wie geht es dir is asked of people you know and expects a real answer — Germans do not use it as a passing greeting with strangers or shop staff. Asked seriously, it may also get a serious answer, including a genuinely bad one.",
    examples: [
      "Wie geht es dir? — Ehrlich gesagt, nicht so gut.",
      "Na, wie geht es? — Ganz gut, und dir?",
      "Guten Tag! — as the whole greeting to a stranger",
    ],
    mistakes: [
      "*Wie geht es Ihnen? — to a cashier, in passing → Guten Tag. The question invites a conversation you are not starting.",
      "*Gut, danke! — every single time → Muss, or Ganz okay, when it is true; a real question deserves a real answer.",
    ],
    related: ["du_oder_sie"],
  },
  // --- A2 -------------------------------------------------------------
  {
    key: "puenktlichkeit_und_absagen",
    explanation:
      "Being on time is read as respect: for a private invitation, arrive within a few minutes of the agreed time, and for anything official, slightly early. If you cannot make it, cancel as soon as you know — with a reason and an apology. A silent no-show, or a cancellation an hour before, costs trust.",
    examples: [
      "Ich schaffe es leider nicht, tut mir wirklich leid.",
      "Können wir auf nächste Woche verschieben?",
      "Ich komme fünf Minuten später — Entschuldigung!",
    ],
    mistakes: [
      "*Einfach nicht hingehen und nichts sagen → Ich muss leider absagen. A no-show without a word reads as disrespect.",
      "*Ich komme vielleicht — as an accepted invitation → Ich komme, or Ich kann leider nicht. A firm yes or a clear no.",
    ],
    related: ["modal_verb_wollen"],
  },
  {
    key: "schriftliche_anrede",
    explanation:
      "Formal letters and mails open with Sehr geehrte Frau X or Sehr geehrter Herr Y and close with Mit freundlichen Grüßen. In the text, the formal Sie, Ihnen and Ihr keep their capital letter. Liebe and Viele Grüße belong to people you already know.",
    examples: [
      "Sehr geehrte Frau Weber, ...",
      "Mit freundlichen Grüßen, Raj Kumar",
      "Vielen Dank für Ihre Antwort.",
    ],
    mistakes: [
      "*Hallo Herr Weber — in a job application → Sehr geehrter Herr Weber. Applications keep the full formal register.",
      "*vielen Dank für ihre Antwort → für Ihre Antwort. The formal Ihr is capitalised everywhere in the sentence.",
    ],
    related: ["formal_register_sie"],
  },
  {
    key: "reklamieren_mit_stil",
    explanation:
      "Complaining is normal and direct in Germany: name the problem plainly, say what you want done, and stay formal. The softness comes from Konjunktiv II — Ich hätte gern, Könnten Sie — not from apologising for complaining at all.",
    examples: [
      "Die Jacke ist kaputt. Ich möchte sie umtauschen.",
      "Ich hätte gern mein Geld zurück.",
      "Könnten Sie das bitte prüfen?",
    ],
    mistakes: [
      "*Entschuldigung, es tut mir leid, aber vielleicht ist die Jacke eventuell kaputt? → Die Jacke ist kaputt. Name the problem; the politeness sits in the request, not in apology stacking.",
      "*Das ist Betrug! — for a broken zip → Ich möchte die Jacke reklamieren. Direct, not dramatic.",
    ],
    related: ["modal_verb_duerfen", "bitten_abschwaechen"],
  },
  {
    key: "duzen_anbieten",
    explanation:
      "The switch from Sie to du is offered, not taken — and by the older or more senior person. A common form is: Wir können uns duzen. Ich bin Anna. Accept with your own first name. Once agreed, the du is permanent; switching back would be an insult.",
    examples: [
      "Wir können uns duzen. Ich bin Anna.",
      "Gern! Ich bin Raj.",
      "Sollen wir beim Du bleiben?",
    ],
    mistakes: [
      "*Du, Frau Weber, hast recht — uninvited, to a senior colleague → Sie haben recht, until she offers the du.",
      "*Sie sind sehr nett, Anna! — after agreeing on du → Du bist sehr nett. The du, once offered, stays.",
    ],
    related: ["du_oder_sie", "sie_und_du_im_beruf"],
  },
  {
    key: "smalltalk_themen",
    explanation:
      "Safe small-talk ground: weather, travel, food, the region, how the journey was. Salary, rent, weight, and probing personal questions come across as intrusive early on. And a pause in the conversation is not hostility — German small talk tolerates silence better than English does.",
    examples: [
      "Ganz schön kalt heute, oder?",
      "Waren Sie schon mal in Dresden?",
      "Wie war die Anreise?",
    ],
    mistakes: [
      "*Was verdienst du eigentlich? — at a first meeting → Was machst du beruflich? The job is fine; the number is not.",
      "*Nervously filling every pause → Eine kurze Stille ist okay. Silence is not an emergency.",
    ],
    related: ["w_questions"],
  },
  // --- B1 -------------------------------------------------------------
  {
    key: "bitten_abschwaechen",
    explanation:
      "German softens a request with Konjunktiv II plus small words — mal, kurz, vielleicht, eventuell — rather than by repeating bitte. Könnten Sie mir kurz helfen? is softer than Bitte bitte helfen Sie mir, and sounds like a native speaker rather than a plea.",
    examples: [
      "Könnten Sie mir kurz helfen?",
      "Würdest du mal das Fenster aufmachen?",
      "Hätten Sie vielleicht einen Moment Zeit?",
    ],
    mistakes: [
      "*Helfen Sie mir, bitte, bitte! → Könnten Sie mir vielleicht helfen? Softness comes from the Konjunktiv and the particles, not from stacking bitte.",
      "*Ich will, dass Sie mir helfen → Ich hätte eine Bitte an Sie. A bare ich will reads as a demand.",
    ],
    related: ["konjunktiv_ii_politeness"],
  },
  {
    key: "sie_und_du_im_beruf",
    explanation:
      "Sie plus the surname is the workplace default, even between people who have shared an office for years. Some teams — start-ups especially — agree on du for everyone. Follow the local convention and the lead of senior colleagues, not your instinct from English-speaking workplaces.",
    examples: [
      "Frau Weber, hätten Sie kurz Zeit?",
      "Bei uns duzen sich alle — auch der Chef.",
      "Herr Schmidt, was halten Sie davon?",
    ],
    mistakes: [
      "*Du, Chef, hast du kurz Zeit? — in a Sie workplace → Hätten Sie kurz Zeit? The office convention outranks friendliness.",
      "*Frau Weber, Sie... — in a team that agreed on du → Anna, du... Refusing the agreed du also lands wrong.",
    ],
    related: ["duzen_anbieten", "formal_register_sie"],
  },
  {
    key: "vorstellungsgespraech_umgangsformen",
    explanation:
      "In a job interview the register is part of what is assessed: Sie throughout, Herr or Frau plus surname, titles where they exist, a firm greeting, and arrive early rather than on the dot. Wait for the interviewer to offer a seat, and never slide into du even if the mood is warm.",
    examples: [
      "Guten Tag, Frau Dr. Weber. Danke für die Einladung.",
      "Gern beantworte ich Ihre Frage.",
      "Ich freue mich auf Ihre Rückmeldung.",
    ],
    mistakes: [
      "*Hi! Ich bin der Raj. — as an interview opening → Guten Tag, mein Name ist Raj Kumar. First names alone are for later.",
      "*Punkt zehn Uhr eintreffen → zehn Minuten früher da sein. On the dot already counts as knapp.",
    ],
    related: ["schriftliche_anrede", "sie_und_du_im_beruf"],
  },
  {
    key: "amtssprache",
    explanation:
      "At the Behörde everything runs on Sie, Termine and paper: address officials formally, bring every document, and expect the language of forms — der Antrag, die Bescheinigung, zuständig. Matching the register and having the papers ready lowers the friction more than charm does.",
    examples: [
      "Ich habe einen Termin um zehn Uhr.",
      "Welche Unterlagen brauchen Sie von mir?",
      "Ist diese Stelle für die Anmeldung zuständig?",
    ],
    mistakes: [
      "*Kannst du mir das Formular geben? — at the counter → Könnten Sie mir das Formular geben? Officials get Sie, always.",
      "*Einfach ohne Termin vorbeigehen → vorher einen Termin vereinbaren. The Termin is the door.",
    ],
    related: ["fremde_ansprechen", "nominalisation"],
  },
  {
    key: "direktheit_verstehen",
    explanation:
      "German feedback is sachlich: about the thing, not the person. Das stimmt nicht is a normal sentence in a meeting, not an attack — and blunt disagreement usually signals engagement, not hostility. Read directness as information; answer it in kind, calmly and with reasons.",
    examples: [
      "Das sehe ich anders, weil ...",
      "Der Plan hat ein Problem: der Termin ist zu knapp.",
      "Da haben Sie recht, das war mein Fehler.",
    ],
    mistakes: [
      "*Taking Das stimmt nicht as a personal insult → Es geht um die Sache. Disagreement with the point is not disrespect for the person.",
      "*Ich bin nicht sicher, aber vielleicht, eventuell ... — to soften real criticism → Ich sehe ein Problem. Sagen, was Sache ist.",
    ],
    related: ["smalltalk_themen"],
  },
  {
    key: "regionale_gruesse",
    explanation:
      "Hallo works everywhere, but the regions greet in their own words: Moin in the north — at any hour, not just mornings — Grüß Gott and Servus in the south and in Austria, Grüezi over the Swiss border. Using the local greeting reads as friendly; correcting someone's Moin at 3 pm reads as not knowing it.",
    examples: [
      "Moin! — in Hamburg, auch nachmittags",
      "Grüß Gott! — in München",
      "Servus, bis später!",
    ],
    mistakes: [
      "*Moin heißt guten Morgen → Moin gilt den ganzen Tag. It is a greeting, not a time of day.",
      "*Grüß Gott — in Hamburg → Moin. The southern greeting travels badly north.",
    ],
    related: ["du_oder_sie"],
  },
];
