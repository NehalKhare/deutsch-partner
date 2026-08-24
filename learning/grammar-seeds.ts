/**
 * The grammar patterns the curriculum teaches, one entry per slug.
 *
 * This is what the tutor quotes when it corrects someone, so the field that
 * matters most is `mistakes`: the wrong form marked with a star, then the
 * right one. An explanation a learner reads once is worth less than the exact
 * sentence they keep producing.
 *
 * Explanations are in English. Grammar has to be understood before it can be
 * practised, and an A1 learner cannot read a German explanation of the case
 * that would let them read it. Examples and mistakes are in German, because
 * that is the part worth imitating.
 *
 * Key, name, level and CEFR band are not here: the slug comes from the
 * curriculum, the name from GRAMMAR_LABELS, and the level from wherever the
 * curriculum first teaches it. See learning/grammar-catalogue.ts.
 */
export interface GrammarSeed {
  readonly key: string;
  readonly explanation: string;
  readonly examples: readonly string[];
  /** Wrong form, then right form. The star marks what not to say. */
  readonly mistakes: readonly string[];
  readonly related: readonly string[];
  /** 1 to 5. Defaults to the band the level sits in; set it where the pattern is harder than its position suggests. */
  readonly difficulty?: number;
}

export const GRAMMAR_SEEDS: readonly GrammarSeed[] = [
  // --- A1 -------------------------------------------------------------
  {
    key: "sein_present",
    explanation:
      "sein is irregular and the most common verb in German. Learn ich bin, du bist, er/sie/es ist, wir sind, ihr seid, sie/Sie sind as one block: almost every early sentence about who or what something is needs it.",
    examples: ["Ich bin Lehrerin.", "Wir sind aus Indien.", "Bist du müde?"],
    mistakes: [
      "*Ich bin eine Lehrerin → Ich bin Lehrerin. German drops the article before a profession.",
      "*Du bin müde → Du bist müde.",
    ],
    related: ["personal_pronouns_nominative", "haben_present"],
  },
  {
    key: "personal_pronouns_nominative",
    explanation:
      "ich, du, er, sie, es, wir, ihr, sie and Sie. The one to watch is sie: lower case it means she or they, capitalised in the middle of a sentence it means the formal you.",
    examples: ["Er kommt aus Berlin.", "Wie heißen Sie?", "Wir wohnen in Köln."],
    mistakes: [
      "*Sie heißt Herr Weber → Er heißt Herr Weber.",
      "*Du sind Frau Weber → Sie sind Frau Weber, if you are being formal.",
    ],
    related: ["sein_present", "regular_verb_present"],
  },
  {
    key: "regular_verb_present",
    explanation:
      "Take the stem and add -e, -st, -t, -en, -t, -en. Most German verbs work this way, so once the endings are automatic a very large number of verbs come free.",
    examples: ["Ich wohne in Hamburg.", "Wohnst du hier?", "Sie arbeiten viel."],
    mistakes: [
      "*Er wohne in Berlin → Er wohnt in Berlin.",
      "*Ich arbeitst → Ich arbeite. The -st ending belongs to du.",
    ],
    related: ["verb_position_second", "sein_present"],
  },
  {
    key: "w_questions",
    explanation:
      "Question word first, conjugated verb straight after it, then the subject. wer asks about people, was about things, wo about place, wie about manner.",
    examples: ["Wo wohnst du?", "Was machst du?", "Wie heißt sie?"],
    mistakes: [
      "*Wo du wohnst? → Wo wohnst du? The verb comes straight after the question word.",
      "*Wer ist das, das Buch? → Was ist das? wer is only for people.",
    ],
    related: ["yes_no_questions", "verb_position_second"],
  },
  {
    key: "numbers_0_100",
    explanation:
      "Above twenty the unit is said before the ten and joined with und, so 21 is einundzwanzig. It reads backwards to an English speaker and stays awkward until it is drilled.",
    examples: [
      "Ich bin einundzwanzig Jahre alt.",
      "Das kostet sechsundneunzig Euro.",
      "Wir treffen uns um sieben.",
    ],
    mistakes: [
      "*zwanzigeins → einundzwanzig. The unit comes first, joined by und.",
      "*siebenzehn → siebzehn. sieben loses its -en in 17 and 70.",
    ],
    related: ["wie_viel_questions"],
  },
  {
    key: "yes_no_questions",
    explanation:
      "With no question word the conjugated verb moves to the front. Raising your voice at the end of a statement is understood but marks you out as a beginner.",
    examples: ["Kommst du mit?", "Ist das dein Buch?", "Habt ihr Zeit?"],
    mistakes: [
      "*Du kommst mit? → Kommst du mit?",
      "*Hast Zeit du? → Hast du Zeit?",
    ],
    related: ["w_questions", "verb_position_second"],
  },
  {
    key: "definite_articles_nominative",
    explanation:
      "der for masculine, die for feminine, das for neuter, die for all plurals. The article is part of the word: learn der Tisch, never Tisch on its own.",
    examples: ["Der Tisch ist neu.", "Die Tür ist offen.", "Das Fenster ist groß."],
    mistakes: ["*Die Tisch ist neu → Der Tisch ist neu.", "*Das Tür → Die Tür."],
    related: ["noun_gender", "indefinite_article_accusative"],
  },
  {
    key: "noun_gender",
    explanation:
      "Gender is mostly not guessable, but some endings are reliable: -ung, -heit, -keit, -schaft and -ion are feminine; -chen and -lein are neuter; -er for a person doing something is masculine.",
    examples: [
      "die Wohnung, die Freiheit, die Möglichkeit",
      "das Mädchen, das Brötchen",
      "der Lehrer, der Bäcker",
    ],
    mistakes: [
      "*der Wohnung → die Wohnung. Nouns in -ung are feminine.",
      "*die Mädchen → das Mädchen. Every -chen word is neuter, whatever it means.",
    ],
    related: ["definite_articles_nominative", "plural_nouns"],
  },
  {
    key: "haben_present",
    explanation:
      "ich habe, du hast, er/sie/es hat, wir haben, ihr habt, sie haben. Beyond possession it is half of the Perfekt, so it is worth being fast with.",
    examples: ["Ich habe keine Zeit.", "Hast du Hunger?", "Wir haben ein Auto."],
    mistakes: ["*Er habt → Er hat.", "*Ich habe kein Zeit → Ich habe keine Zeit."],
    related: ["sein_present", "indefinite_article_accusative", "perfekt_with_haben"],
  },
  {
    key: "indefinite_article_accusative",
    explanation:
      "ein, eine, ein as a subject; as a direct object only the masculine changes, to einen. kein takes exactly the same endings.",
    examples: [
      "Ich habe einen Bruder.",
      "Sie kauft eine Tasche.",
      "Wir brauchen ein Buch.",
    ],
    mistakes: [
      "*Ich habe ein Bruder → Ich habe einen Bruder.",
      "*Sie kauft einen Tasche → Sie kauft eine Tasche. Only the masculine changes.",
    ],
    related: ["accusative_case_objects", "definite_articles_nominative"],
  },
  {
    key: "possessive_articles_nominative",
    explanation:
      "mein, dein, sein, ihr, unser, euer, ihr and Ihr. They take the same endings as ein, so the ending follows the thing owned, not the owner.",
    examples: [
      "Mein Bruder wohnt in Bonn.",
      "Meine Schwester ist Ärztin.",
      "Ist das dein Schlüssel?",
    ],
    mistakes: [
      "*Mein Schwester → Meine Schwester.",
      "*Sein Mutter → Seine Mutter. The ending follows Mutter, not the son.",
    ],
    related: ["definite_articles_nominative", "noun_gender"],
  },
  {
    key: "plural_nouns",
    explanation:
      "Five main patterns: -e, -er, -(e)n, -s and no ending, often with an umlaut. There is no shortcut, so the plural is learnt with the word and the article, as a set of three.",
    examples: [
      "der Tisch → die Tische",
      "das Buch → die Bücher",
      "die Frau → die Frauen",
    ],
    mistakes: [
      "*die Buches → die Bücher.",
      "*die Frauens → die Frauen. Only a few loanwords take -s.",
    ],
    related: ["noun_gender", "definite_articles_nominative"],
  },
  {
    key: "verb_position_second",
    explanation:
      "The conjugated verb is the second element of a main clause, not the second word. Whatever you put first, the verb holds its place and the subject moves behind it.",
    examples: [
      "Ich fahre morgen nach Köln.",
      "Morgen fahre ich nach Köln.",
      "Nach Köln fahre ich morgen.",
    ],
    mistakes: [
      "*Morgen ich fahre nach Köln → Morgen fahre ich nach Köln.",
      "*Heute wir gehen ins Kino → Heute gehen wir ins Kino.",
    ],
    related: ["word_order_main_clause", "w_questions"],
  },
  {
    key: "gern_with_verbs",
    explanation:
      "gern is not a verb. It sits after the conjugated verb and turns any activity into one you enjoy, which is how German usually says I like doing something.",
    examples: ["Ich koche gern.", "Er spielt gern Fußball.", "Trinkst du gern Kaffee?"],
    mistakes: [
      "*Ich gern koche → Ich koche gern.",
      "*Ich mag kochen gern → Ich koche gern. Use one or the other, not both.",
    ],
    related: ["verb_position_second"],
  },
  {
    key: "moechten_present",
    explanation:
      "ich möchte, du möchtest, er möchte, wir möchten. It is the polite way to ask for anything, and the main verb, if there is one, goes to the end in the infinitive.",
    examples: [
      "Ich möchte einen Kaffee.",
      "Möchten Sie etwas trinken?",
      "Wir möchten bestellen.",
    ],
    mistakes: [
      "*Ich will einen Kaffee → Ich möchte einen Kaffee. wollen sounds blunt when ordering.",
      "*Ich möchte einen Kaffee zu trinken → Ich möchte einen Kaffee trinken.",
    ],
    related: ["modal_verbs_koennen_muessen", "accusative_case_objects"],
  },
  {
    key: "accusative_case_objects",
    explanation:
      "The thing the verb acts on takes the accusative. In practice only the masculine looks different: der becomes den and ein becomes einen. Everything else keeps its nominative form.",
    examples: ["Ich sehe den Mann.", "Sie liest das Buch.", "Wir bestellen die Suppe."],
    mistakes: [
      "*Ich sehe der Mann → Ich sehe den Mann.",
      "*Ich trinke der Kaffee → Ich trinke den Kaffee.",
    ],
    related: ["indefinite_article_accusative", "dative_case_people", "es_gibt"],
  },
  {
    key: "wie_viel_questions",
    explanation:
      "wie viel for something you cannot count, wie viele for something you can. The same split as much and many in English, and it holds consistently.",
    examples: [
      "Wie viel kostet das?",
      "Wie viele Geschwister hast du?",
      "Wie viel Zeit brauchst du?",
    ],
    mistakes: [
      "*Wie viele kostet das? → Wie viel kostet das?",
      "*Wie viel Bücher hast du? → Wie viele Bücher hast du?",
    ],
    related: ["numbers_0_100"],
  },
  {
    key: "separable_verbs",
    explanation:
      "Verbs like aufstehen, ankommen and einsteigen split in a main clause: the verb is conjugated in second place and the prefix goes to the very end.",
    examples: [
      "Ich stehe um sechs auf.",
      "Wann kommt der Zug an?",
      "Steig bitte vorne ein.",
    ],
    mistakes: [
      "*Ich aufstehe um sechs → Ich stehe um sechs auf.",
      "*Ich habe angerufen dich → Ich habe dich angerufen.",
    ],
    related: ["verb_position_second", "perfekt_with_haben"],
  },
  {
    key: "time_expressions_um_am",
    explanation:
      "um for clock times, am for days and parts of the day, im for months and seasons. am and im are contractions of an dem and in dem, which is why they are dative.",
    examples: [
      "Wir treffen uns um acht.",
      "Am Montag habe ich frei.",
      "Im Juli fahren wir weg.",
    ],
    mistakes: ["*in Montag → am Montag.", "*am acht Uhr → um acht Uhr."],
    related: ["dative_prepositions_place"],
  },
  {
    key: "dative_prepositions_place",
    explanation:
      "bei, zu, aus and von always take the dative, whether or not anything is moving. Watch the contractions: zu dem becomes zum, zu der becomes zur, bei dem becomes beim.",
    examples: ["Ich bin bei der Arbeit.", "Sie geht zum Arzt.", "Wir kommen aus der Stadt."],
    mistakes: [
      "*bei die Arbeit → bei der Arbeit.",
      "*zu dem Arzt → zum Arzt.",
    ],
    related: ["two_way_prepositions_static", "dative_prepositions_fixed"],
  },
  {
    key: "imperative_formal",
    explanation:
      "Verb first, then Sie. Unlike the informal imperative the pronoun stays, which makes the formal command easy to build: take the Sie form and swap the two words round.",
    examples: [
      "Gehen Sie geradeaus.",
      "Nehmen Sie bitte Platz.",
      "Warten Sie einen Moment.",
    ],
    mistakes: [
      "*Sie gehen geradeaus → Gehen Sie geradeaus.",
      "*Gehen geradeaus → Gehen Sie geradeaus. The formal imperative keeps Sie.",
    ],
    related: ["imperative_informal", "formal_register_sie"],
  },
  {
    key: "es_gibt",
    explanation:
      "es gibt is how German says there is and there are, and it never changes for number. Whatever follows it is a direct object, so it takes the accusative.",
    examples: [
      "Hier gibt es einen Bahnhof.",
      "Es gibt keinen Kaffee mehr.",
      "Gibt es hier ein Café?",
    ],
    mistakes: [
      "*Es gibt ein Bahnhof → Es gibt einen Bahnhof.",
      "*Es geben viele Cafés → Es gibt viele Cafés. It stays singular.",
    ],
    related: ["accusative_case_objects"],
  },
  {
    key: "two_way_prepositions_static",
    explanation:
      "in, an, auf, über, unter, vor, hinter, neben and zwischen take the dative when they answer wo, meaning nothing is moving from one place to another.",
    examples: [
      "Das Buch liegt auf dem Tisch.",
      "Wir sitzen im Garten.",
      "Das Bild hängt über dem Sofa.",
    ],
    mistakes: [
      "*Das Buch liegt auf den Tisch → auf dem Tisch.",
      "*In die Küche koche ich → In der Küche koche ich.",
    ],
    related: ["two_way_prepositions_motion", "verbs_of_placement"],
    difficulty: 3,
  },
  {
    key: "perfekt_with_haben",
    explanation:
      "The everyday past tense in speech: haben conjugated in second place, past participle at the very end. Most verbs take haben.",
    examples: [
      "Ich habe einen Film gesehen.",
      "Wir haben gestern gekocht.",
      "Hast du das gemacht?",
    ],
    mistakes: [
      "*Ich habe gesehen einen Film → Ich habe einen Film gesehen.",
      "*Ich habe gegangen → Ich bin gegangen. Movement takes sein.",
    ],
    related: ["past_participles_regular", "perfekt_with_sein"],
  },
  {
    key: "past_participles_regular",
    explanation:
      "ge- plus the stem plus -t. Two groups take no ge- at all: verbs beginning with be-, ver-, er-, ent- or zer-, and verbs ending in -ieren.",
    examples: ["machen → gemacht", "kochen → gekocht", "arbeiten → gearbeitet"],
    mistakes: [
      "*Ich habe gebestellt → Ich habe bestellt.",
      "*Ich habe gestudiert → Ich habe studiert. Verbs in -ieren take no ge-.",
    ],
    related: ["perfekt_with_haben", "past_participles_irregular"],
  },
  {
    key: "perfekt_with_sein",
    explanation:
      "sein rather than haben for verbs of movement from one place to another and for a change of state, plus sein and bleiben themselves. The list is short enough to learn outright.",
    examples: [
      "Ich bin nach Berlin gefahren.",
      "Wir sind früh aufgestanden.",
      "Sie ist eingeschlafen.",
    ],
    mistakes: [
      "*Ich habe nach Berlin gefahren → Ich bin nach Berlin gefahren.",
      "*Ich bin einen Film gesehen → Ich habe einen Film gesehen.",
    ],
    related: ["perfekt_with_haben", "past_participles_irregular"],
  },
  {
    key: "past_participles_irregular",
    explanation:
      "Strong verbs take ge- plus a changed stem plus -en. There is no rule for the vowel change, so these are learnt as a list, and they are exactly the verbs used most often.",
    examples: ["gehen → gegangen", "fahren → gefahren", "trinken → getrunken"],
    mistakes: ["*Ich habe getrinkt → Ich habe getrunken.", "*Ich bin gegeht → Ich bin gegangen."],
    related: ["past_participles_regular", "perfekt_with_sein"],
  },
  {
    key: "modal_verbs_koennen_muessen",
    explanation:
      "The modal is conjugated in second place and the main verb goes to the end as a bare infinitive, with no zu. Note that ich and er share a form: ich kann, er kann.",
    examples: [
      "Ich kann heute nicht kommen.",
      "Wir müssen früh aufstehen.",
      "Kannst du mir helfen?",
    ],
    mistakes: [
      "*Ich kann nicht kommen heute → Ich kann heute nicht kommen.",
      "*Ich muss zu arbeiten → Ich muss arbeiten. No zu after a modal.",
    ],
    related: ["modal_verb_wollen", "modal_verb_sollen", "verb_position_second"],
  },
  {
    key: "negation_nicht_kein",
    explanation:
      "kein negates a noun that would otherwise have ein or no article at all. nicht negates everything else, and normally stands just before whatever it is denying.",
    examples: [
      "Ich habe kein Geld.",
      "Das ist nicht mein Buch.",
      "Ich komme heute nicht.",
    ],
    mistakes: [
      "*Ich habe nicht Geld → Ich habe kein Geld.",
      "*Das ist kein mein Buch → Das ist nicht mein Buch.",
    ],
    related: ["indefinite_article_accusative"],
  },

  // --- A2 -------------------------------------------------------------
  {
    key: "dative_case_people",
    explanation:
      "The person something is given to, said to or done for takes the dative: dem, der, dem, den. Some verbs take it outright, notably helfen, danken, gehören, gefallen and antworten.",
    examples: [
      "Ich helfe meinem Bruder.",
      "Sie gibt der Kollegin das Buch.",
      "Das gehört den Kindern.",
    ],
    mistakes: [
      "*Ich helfe meinen Bruder → Ich helfe meinem Bruder. helfen takes the dative.",
      "*Das gehört den Kinder → den Kindern. The dative plural adds -n.",
    ],
    related: ["accusative_case_objects", "dative_prepositions_fixed"],
    difficulty: 3,
  },
  {
    key: "modal_verb_wollen",
    explanation:
      "wollen is a stated intention, and it is stronger than English want. For requests it sounds abrupt, which is why möchten exists.",
    examples: ["Ich will Deutsch lernen.", "Willst du mitkommen?", "Sie wollen umziehen."],
    mistakes: [
      "*Ich will einen Kaffee, bitte → Ich möchte einen Kaffee, bitte.",
      "*Ich wille → Ich will. Modals take no ending in the ich form.",
    ],
    related: ["modal_verbs_koennen_muessen", "moechten_present"],
  },
  {
    key: "imperative_informal",
    explanation:
      "For du, take the present tense form and drop the -st and the pronoun. For ihr, the present form is already the imperative. Strong verbs that change e to i keep the change.",
    examples: ["Komm bitte her!", "Nimm dir einen Stuhl.", "Kommt rein!"],
    mistakes: [
      "*Kommst du her! → Komm her!",
      "*Gebe mir das → Gib mir das. geben changes its vowel.",
    ],
    related: ["imperative_formal", "modal_particles"],
  },
  {
    key: "modal_verb_sollen",
    explanation:
      "sollen reports an expectation that comes from somewhere else: advice, an instruction, what someone said you ought to do. It is not what you yourself want.",
    examples: [
      "Du sollst mehr schlafen.",
      "Der Arzt sagt, ich soll Sport machen.",
      "Was soll ich tun?",
    ],
    mistakes: [
      "*Ich soll einen Kaffee → Ich möchte einen Kaffee.",
      "*Du sollst zu gehen → Du sollst gehen.",
    ],
    related: ["modal_verbs_koennen_muessen", "konjunktiv_ii_politeness"],
  },
  {
    key: "comparative_forms",
    explanation:
      "Add -er and compare with als. Most short adjectives take an umlaut as well: alt becomes älter, groß becomes größer. gut, viel and gern are irregular.",
    examples: [
      "Berlin ist größer als Bremen.",
      "Der Zug ist schneller als der Bus.",
      "Heute ist es wärmer.",
    ],
    mistakes: [
      "*größer wie Bremen → größer als Bremen. wie is for things that are equal.",
      "*mehr groß → größer. German does not build comparatives with mehr.",
    ],
    related: ["superlative_forms", "comparative_structures_je_desto"],
  },
  {
    key: "subordinate_clause_weil",
    explanation:
      "weil sends the conjugated verb to the end of its clause. If the weil-clause comes first, the main clause then starts with its verb, because the whole clause counts as the first element.",
    examples: [
      "Ich bleibe zu Hause, weil ich müde bin.",
      "Sie lernt Deutsch, weil sie in Wien arbeitet.",
      "Weil es regnet, nehme ich den Bus.",
    ],
    mistakes: [
      "*weil ich bin müde → weil ich müde bin.",
      "*Weil es regnet, ich nehme den Bus → ..., nehme ich den Bus.",
    ],
    related: ["subordinate_clause_dass", "word_order_main_clause"],
  },
  {
    key: "two_way_prepositions_motion",
    explanation:
      "The same nine prepositions take the accusative when they answer wohin, meaning something crosses from one place into another. Direction is accusative, position is dative.",
    examples: [
      "Ich gehe in die Küche.",
      "Stell die Flasche auf den Tisch.",
      "Er hängt das Bild über das Sofa.",
    ],
    mistakes: [
      "*Ich gehe in der Küche → in die Küche, if you are moving there.",
      "*Stell das Buch auf dem Tisch → auf den Tisch.",
    ],
    related: ["two_way_prepositions_static", "verbs_of_placement"],
    difficulty: 3,
  },
  {
    key: "verbs_of_placement",
    explanation:
      "German splits putting from being. stellen, legen and hängen describe the act and take the accusative; stehen, liegen and hängen describe the result and take the dative.",
    examples: [
      "Ich stelle die Flasche in den Kühlschrank.",
      "Die Flasche steht im Kühlschrank.",
      "Leg das Handtuch bitte ins Regal.",
    ],
    mistakes: [
      "*Ich stehe die Flasche in den Kühlschrank → Ich stelle die Flasche hinein.",
      "*Das Buch legt auf dem Tisch → Das Buch liegt auf dem Tisch.",
    ],
    related: ["two_way_prepositions_motion", "two_way_prepositions_static"],
    difficulty: 3,
  },
  {
    key: "future_with_werden",
    explanation:
      "werden conjugated plus the infinitive at the end. German uses it less than English does: with a time word the present tense is the normal way to talk about the future.",
    examples: [
      "Ich werde nächstes Jahr umziehen.",
      "Es wird morgen regnen.",
      "Wir werden dir helfen.",
    ],
    mistakes: [
      "*Ich werde morgen zu arbeiten → Ich werde morgen arbeiten.",
      "*Ich werde morgen kommen is heavy → Ich komme morgen.",
    ],
    related: ["futur_ii", "modal_verb_wollen"],
  },
  {
    key: "subordinate_clause_wenn",
    explanation:
      "wenn introduces a condition and sends the verb to the end. Unlike English if, it also covers whenever, which is why als exists for single past events.",
    examples: [
      "Wenn es regnet, bleiben wir zu Hause.",
      "Ich rufe dich an, wenn ich ankomme.",
      "Wenn du Zeit hast, komm vorbei.",
    ],
    mistakes: [
      "*Wenn es regnet, wir bleiben zu Hause → ..., bleiben wir zu Hause.",
      "*Wann es regnet → Wenn es regnet. wann only asks a question.",
    ],
    related: ["temporal_clause_wenn", "irreal_conditional_wenn", "conditional_clauses_falls"],
  },
  {
    key: "indirect_questions",
    explanation:
      "Wrap a question in a polite frame and it becomes a subordinate clause, so the verb goes to the end. This is the single most useful politeness move at a counter or on the phone.",
    examples: [
      "Können Sie mir sagen, wo der Bahnhof ist?",
      "Ich weiß nicht, wann der Zug kommt.",
      "Wissen Sie, ob der Zug pünktlich ist?",
    ],
    mistakes: [
      "*Können Sie mir sagen, wo ist der Bahnhof? → ..., wo der Bahnhof ist?",
      "*Ich weiß nicht, was ist das → ..., was das ist.",
    ],
    related: ["subordinate_clause_ob", "w_questions"],
  },
  {
    key: "subordinate_clause_ob",
    explanation:
      "ob reports a yes-or-no question and means whether. It is not interchangeable with wenn, which is a condition, even though English if covers both.",
    examples: [
      "Ich weiß nicht, ob er kommt.",
      "Sie fragt, ob wir Zeit haben.",
      "Ob das stimmt, weiß niemand.",
    ],
    mistakes: [
      "*Ich weiß nicht, wenn er kommt → ..., ob er kommt.",
      "*Sie fragt, ob haben wir Zeit → ..., ob wir Zeit haben.",
    ],
    related: ["indirect_questions", "subordinate_clause_dass"],
  },
  {
    key: "dative_prepositions_fixed",
    explanation:
      "mit, nach, von, zu, bei, seit, aus and außer always take the dative, with no exceptions and no wo-versus-wohin question to ask. Learn them as a chant.",
    examples: [
      "Ich fahre mit dem Zug.",
      "Nach der Arbeit gehe ich schwimmen.",
      "Seit einem Jahr wohne ich hier.",
    ],
    mistakes: ["*mit den Zug → mit dem Zug.", "*seit ein Jahr → seit einem Jahr."],
    related: ["dative_case_people", "dative_prepositions_place"],
  },
  {
    key: "temporal_clause_wenn",
    explanation:
      "For something that happens repeatedly, in the present or the past, wenn is the right word and often carries immer. A single completed past event takes als instead.",
    examples: [
      "Wenn ich Zeit habe, koche ich.",
      "Immer wenn er kam, brachte er Blumen mit.",
      "Wenn es schneit, steht die Stadt still.",
    ],
    mistakes: [
      "*Als ich Zeit habe → Wenn ich Zeit habe. als is only for the past.",
      "*Wenn ich zwanzig wurde, zog ich nach Berlin → Als ich zwanzig wurde, ...",
    ],
    related: ["temporal_clause_als", "subordinate_clause_wenn"],
  },
  {
    key: "konjunktiv_ii_politeness",
    explanation:
      "würde, könnte, hätte and wäre soften a request into something a stranger will happily answer. In service and office German this is the default register, not an extra.",
    examples: [
      "Könnten Sie mir bitte helfen?",
      "Ich hätte eine Frage.",
      "Ich würde gern einen Termin vereinbaren.",
    ],
    mistakes: [
      "*Ich will einen Termin → Ich hätte gern einen Termin.",
      "*Ich würde gern haben einen Termin → Ich hätte gern einen Termin.",
    ],
    related: ["konjunktiv_ii_present", "formal_register_sie"],
  },
  {
    key: "formal_register_sie",
    explanation:
      "Sie, Ihr and Ihnen are capitalised wherever they stand. A letter opens with Sehr geehrte Frau or Sehr geehrter Herr and closes with Mit freundlichen Grüßen.",
    examples: [
      "Sehr geehrte Frau Weber, ich schreibe Ihnen wegen der Anzeige.",
      "Könnten Sie mir Ihre Unterlagen schicken?",
      "Mit freundlichen Grüßen",
    ],
    mistakes: [
      "*Hallo Frau Weber, kannst du ... → Sehr geehrte Frau Weber, könnten Sie ...",
      "*ihre Unterlagen, meaning yours → Ihre Unterlagen with a capital.",
    ],
    related: ["imperative_formal", "konjunktiv_ii_politeness"],
  },
  {
    key: "subordinate_clause_dass",
    explanation:
      "dass reports what someone says, thinks or feels and sends the verb to the end. The comma before it is not optional in German.",
    examples: [
      "Ich glaube, dass er recht hat.",
      "Sie sagt, dass sie später kommt.",
      "Es ist schade, dass du nicht kommst.",
    ],
    mistakes: [
      "*Ich glaube, dass er hat recht → ..., dass er recht hat.",
      "*Ich glaube dass er recht hat → Ich glaube, dass er recht hat.",
    ],
    related: ["subordinate_clause_weil", "indirect_speech_konjunktiv_i"],
  },
  {
    key: "adjective_endings_definite",
    explanation:
      "After der, die, das and their forms the adjective takes -e in the nominative singular and in the neuter and feminine accusative, and -en everywhere else. Five slots take -e, the rest take -en.",
    examples: ["der neue Tisch", "Ich sehe den neuen Tisch.", "mit dem neuen Tisch"],
    mistakes: [
      "*der neuer Tisch → der neue Tisch.",
      "*Ich sehe den neue Tisch → den neuen Tisch.",
    ],
    related: ["adjective_endings_indefinite", "accusative_case_objects"],
    difficulty: 4,
  },
  {
    key: "adjective_endings_indefinite",
    explanation:
      "ein shows no gender in three slots, so the adjective has to: ein neuer Tisch, ein neues Buch. Where the article does show it, the adjective falls back on -e or -en.",
    examples: ["ein neuer Tisch", "eine neue Tasche", "ein neues Buch"],
    mistakes: [
      "*ein neue Tisch → ein neuer Tisch.",
      "*Ich habe einen neue Tisch → einen neuen Tisch.",
    ],
    related: ["adjective_endings_definite", "indefinite_article_accusative"],
    difficulty: 4,
  },
  {
    key: "modal_verb_duerfen",
    explanation:
      "dürfen is permission, not ability. Darf ich asks whether something is allowed; Kann ich asks whether it is possible, and mixing them is a common English habit.",
    examples: [
      "Darf ich hier rauchen?",
      "Hier darf man nicht parken.",
      "Sie dürfen die Jacke umtauschen.",
    ],
    mistakes: [
      "*Kann ich hier rauchen? → Darf ich hier rauchen?",
      "*Ich darf nicht zu rauchen → Ich darf nicht rauchen.",
    ],
    related: ["modal_verbs_koennen_muessen", "impersonal_man"],
  },
  {
    key: "reflexive_verbs_accusative",
    explanation:
      "mich, dich, sich, uns, euch, sich. With verbs like sich freuen, sich setzen and sich treffen the pronoun is part of the verb, not an optional extra.",
    examples: [
      "Ich freue mich auf den Sommer.",
      "Setz dich bitte.",
      "Wir treffen uns um acht.",
    ],
    mistakes: [
      "*Ich freue auf den Sommer → Ich freue mich auf den Sommer.",
      "*Ich freue mir → Ich freue mich. freuen takes the accusative.",
    ],
    related: ["verbs_with_prepositions", "separable_verbs"],
  },
  {
    key: "verbs_with_prepositions",
    explanation:
      "Many verbs keep a fixed preposition that does not translate: warten auf, denken an, sich freuen über. The preposition also fixes the case, so the pair is learnt together.",
    examples: [
      "Ich warte auf den Bus.",
      "Sie denkt an ihre Familie.",
      "Wir sprechen über die Arbeit.",
    ],
    mistakes: [
      "*Ich warte für den Bus → Ich warte auf den Bus.",
      "*Ich denke über dich, meaning I am thinking of you → Ich denke an dich.",
    ],
    related: ["da_wo_compounds", "reflexive_verbs_accusative"],
    difficulty: 3,
  },
  {
    key: "da_wo_compounds",
    explanation:
      "When the object of a fixed preposition is a thing rather than a person, German fuses the two: darauf, damit, davon. The question form does the same: worauf, womit.",
    examples: ["Ich warte darauf.", "Worauf wartest du?", "Damit bin ich einverstanden."],
    mistakes: [
      "*Ich warte auf es → Ich warte darauf.",
      "*Auf was wartest du? → Worauf wartest du? in careful German.",
    ],
    related: ["verbs_with_prepositions"],
    difficulty: 3,
  },
  {
    key: "praeteritum_common_verbs",
    explanation:
      "war, hatte and the modals are used in the Präteritum even in speech, where other verbs would take the Perfekt. Getting these five or six right sounds instantly more natural.",
    examples: ["Ich war gestern krank.", "Wir hatten keine Zeit.", "Er konnte nicht kommen."],
    mistakes: [
      "*Ich bin gestern krank gewesen → Ich war gestern krank.",
      "*Ich habe nicht kommen gekonnt → Ich konnte nicht kommen.",
    ],
    related: ["praeteritum_vs_perfekt", "temporal_clause_als"],
  },
  {
    key: "temporal_clause_als",
    explanation:
      "als marks one completed event or one stretch of time in the past. If it happened repeatedly, or if it is not in the past, the word is wenn.",
    examples: [
      "Als ich klein war, wohnten wir in Kiel.",
      "Als der Zug ankam, regnete es.",
      "Ich war zwanzig, als ich nach Berlin zog.",
    ],
    mistakes: [
      "*Wenn ich klein war → Als ich klein war.",
      "*Als ich Zeit habe → Wenn ich Zeit habe.",
    ],
    related: ["temporal_clause_wenn", "praeteritum_common_verbs"],
  },
  {
    key: "superlative_forms",
    explanation:
      "Standing alone after a verb, the superlative is am schnellsten. Before a noun it behaves like an ordinary adjective: der schnellste Zug. gut and viel are irregular.",
    examples: [
      "Der Zug ist am schnellsten.",
      "Das ist die beste Lösung.",
      "Im Juli ist es am wärmsten.",
    ],
    mistakes: [
      "*Der Zug ist der schnellste, with no noun → Der Zug ist am schnellsten.",
      "*am gutsten → am besten.",
    ],
    related: ["comparative_forms"],
  },
  {
    key: "subordinate_clause_obwohl",
    explanation:
      "obwohl concedes a point and sends the verb to the end. It is the subordinate counterpart of trotzdem, and using both in one sentence is a common overcorrection.",
    examples: [
      "Obwohl es regnete, sind wir gelaufen.",
      "Ich mag die Stadt, obwohl sie laut ist.",
      "Obwohl er müde war, arbeitete er weiter.",
    ],
    mistakes: [
      "*obwohl es regnete, wir sind gelaufen → ..., sind wir gelaufen.",
      "*Obwohl es regnete, trotzdem sind wir gelaufen → pick one of the two.",
    ],
    related: ["concessive_connectors", "connectors_deshalb_trotzdem"],
  },
  {
    key: "passive_present",
    explanation:
      "werden conjugated plus the past participle at the end. German uses the passive far more than English in signs, rules and descriptions of how things are done.",
    examples: [
      "Der Müll wird dienstags abgeholt.",
      "Hier wird nicht geraucht.",
      "Die Formulare werden online ausgefüllt.",
    ],
    mistakes: [
      "*Der Müll ist abgeholt, meaning it happens regularly → Der Müll wird abgeholt.",
      "*Der Müll wird abholen → Der Müll wird abgeholt.",
    ],
    related: ["passive_with_von_durch", "passive_past", "impersonal_man"],
  },
  {
    key: "impersonal_man",
    explanation:
      "man means one or people in general and always takes the third person singular. It is not the noun Mann, and it is the everyday alternative to the passive.",
    examples: [
      "Hier darf man nicht parken.",
      "In Deutschland trennt man den Müll.",
      "Wie sagt man das auf Deutsch?",
    ],
    mistakes: [
      "*Man sind → Man ist.",
      "*Mann trennt den Müll → Man trennt den Müll.",
    ],
    related: ["passive_present", "modal_verb_duerfen"],
  },
  {
    key: "genitive_case",
    explanation:
      "des and der, with -s or -es added to masculine and neuter nouns. Speech often replaces it with von plus the dative, but writing and set phrases keep it.",
    examples: [
      "Das Auto meines Bruders steht draußen.",
      "Die Farbe der Wand gefällt mir.",
      "Wegen des Wetters bleiben wir hier.",
    ],
    mistakes: [
      "*Das Auto meinem Bruder → Das Auto meines Bruders.",
      "*Wegen dem Wetter → wegen des Wetters. The dative is normal in speech, but writing keeps the genitive.",
    ],
    related: ["dative_case_people", "nominalisation"],
    difficulty: 4,
  },
  {
    key: "subordinate_clause_damit",
    explanation:
      "damit gives a purpose when the two halves have different subjects. When the subject is the same in both, German prefers um plus zu plus the infinitive.",
    examples: [
      "Ich spreche langsam, damit du mich verstehst.",
      "Sie spart, damit ihre Tochter studieren kann.",
      "Damit nichts passiert, prüfen wir alles zweimal.",
    ],
    mistakes: [
      "*damit du mich verstehen kannst is fine, but *damit du mich verstehst kannst → damit du mich verstehst.",
      "*Ich lerne, damit ich Deutsch spreche → Ich lerne, um Deutsch zu sprechen.",
    ],
    related: ["purpose_clause_um_zu"],
  },
  {
    key: "connectors_deshalb_trotzdem",
    explanation:
      "deshalb, deswegen, darum and trotzdem join two main clauses. They count as the first element, so the verb comes straight after them and the subject moves behind it.",
    examples: [
      "Es regnete, deshalb blieben wir zu Hause.",
      "Es war teuer, trotzdem habe ich es gekauft.",
      "Der Zug fiel aus, deswegen kam ich zu spät.",
    ],
    mistakes: [
      "*deshalb wir blieben zu Hause → deshalb blieben wir zu Hause.",
      "*Weil es regnete, deshalb blieben wir → use weil or deshalb, not both.",
    ],
    related: ["word_order_main_clause", "subordinate_clause_weil", "concessive_connectors"],
  },
  {
    key: "word_order_main_clause",
    explanation:
      "The verb is second and the rest follows time, then manner, then place. Pronouns come early, and the accusative pronoun goes before the dative one.",
    examples: [
      "Ich fahre morgen mit dem Zug nach Köln.",
      "Morgen fahre ich mit dem Zug nach Köln.",
      "Ich habe es ihr gestern gesagt.",
    ],
    mistakes: [
      "*Ich fahre nach Köln morgen → Ich fahre morgen nach Köln.",
      "*Gestern ich habe es ihr gesagt → Gestern habe ich es ihr gesagt.",
    ],
    related: ["verb_position_second", "connectors_deshalb_trotzdem"],
  },

  // --- B1 -------------------------------------------------------------
  {
    key: "opinion_phrases",
    explanation:
      "Meiner Meinung nach, Ich finde, Ich halte etwas für and Aus meiner Sicht. Each one counts as the first element of the sentence, so the verb follows immediately.",
    examples: [
      "Meiner Meinung nach ist das zu teuer.",
      "Ich finde, dass man mehr tun müsste.",
      "Ich halte den Vorschlag für sinnvoll.",
    ],
    mistakes: [
      "*Meiner Meinung nach, das ist zu teuer → ... nach ist das zu teuer.",
      "*Ich denke so → Das sehe ich auch so.",
    ],
    related: ["subordinate_clause_dass", "concessive_connectors"],
  },
  {
    key: "concessive_connectors",
    explanation:
      "zwar ... aber sets up a concession and then takes it back. dennoch and allerdings do the same job in one word, and all three keep the verb in second place.",
    examples: [
      "Das Angebot ist zwar günstig, aber die Qualität stimmt nicht.",
      "Er hat wenig Erfahrung, dennoch würde ich ihn nehmen.",
      "Allerdings sehe ich ein Problem.",
    ],
    mistakes: [
      "*Zwar es ist günstig → Zwar ist es günstig.",
      "*Obwohl es günstig ist, aber die Qualität stimmt nicht → drop the aber.",
    ],
    related: ["subordinate_clause_obwohl", "connectors_deshalb_trotzdem", "discourse_connectors"],
  },
  {
    key: "modal_particles",
    explanation:
      "doch, ja, mal, eben and halt carry no dictionary meaning; they carry attitude. doch presses, ja shares surprise, mal softens. They sit just after the verb.",
    examples: ["Komm doch mit!", "Das ist ja interessant.", "Warte mal kurz."],
    mistakes: [
      "*Komm mit doch → Komm doch mit.",
      "*Das ist interessant ja → Das ist ja interessant.",
    ],
    related: ["imperative_informal"],
  },
  {
    key: "praeteritum_vs_perfekt",
    explanation:
      "Speech uses the Perfekt, writing and narration use the Präteritum. The exceptions run the other way: sein, haben and the modals take the Präteritum even in conversation.",
    examples: [
      "Gestern habe ich meine Schwester getroffen.",
      "Er ging zum Fenster und öffnete es.",
      "Ich war müde und hatte keine Lust.",
    ],
    mistakes: [
      "*Ich traf gestern meine Schwester, in conversation → Ich habe gestern meine Schwester getroffen.",
      "*Ich bin gestern krank gewesen → Ich war gestern krank.",
    ],
    related: ["praeteritum_common_verbs", "plusquamperfekt"],
  },
  {
    key: "plusquamperfekt",
    explanation:
      "hatte or war plus the participle, for the thing that happened before the thing you are already telling. It pairs naturally with nachdem.",
    examples: [
      "Nachdem wir gegessen hatten, gingen wir los.",
      "Der Zug war schon abgefahren, als ich ankam.",
      "Ich hatte den Schlüssel vergessen.",
    ],
    mistakes: [
      "*Nachdem wir gegessen haben, gingen wir los → ... gegessen hatten, ...",
      "*Er war gegangen haben → Er war gegangen.",
    ],
    related: ["praeteritum_vs_perfekt", "temporal_clause_als"],
    difficulty: 4,
  },
  {
    key: "relative_clauses_nominative_accusative",
    explanation:
      "The relative pronoun looks like the definite article and takes its gender from the noun it refers back to, but its case from its job in the relative clause. The verb goes to the end.",
    examples: [
      "Der Kollege, der neben mir sitzt, kommt aus Wien.",
      "Das Buch, das ich gerade lese, ist spannend.",
      "Die Frau, die du gesehen hast, ist meine Chefin.",
    ],
    mistakes: [
      "*Der Kollege, der sitzt neben mir → ..., der neben mir sitzt.",
      "*Das Buch, was ich lese → Das Buch, das ich lese. was only follows alles, etwas or nichts.",
    ],
    related: ["relative_clauses_dative_genitive", "relative_clauses_with_prepositions"],
    difficulty: 4,
  },
  {
    key: "relative_clauses_dative_genitive",
    explanation:
      "dem, der and denen when the verb inside the clause takes the dative; dessen and deren for possession. deren is feminine and plural, dessen masculine and neuter.",
    examples: [
      "Der Kollege, dem ich geholfen habe, hat sich bedankt.",
      "Die Nachbarn, denen wir den Schlüssel gaben, sind verreist.",
      "Die Frau, deren Auto dort steht, wohnt hier.",
    ],
    mistakes: [
      "*Der Kollege, den ich geholfen habe → dem ich geholfen habe. helfen takes the dative.",
      "*Die Frau, dessen Auto → deren Auto.",
    ],
    related: ["relative_clauses_nominative_accusative", "genitive_case", "dative_case_people"],
    difficulty: 5,
  },
  {
    key: "relative_clauses_with_prepositions",
    explanation:
      "The preposition comes before the relative pronoun and decides its case. English can strand the preposition at the end; German never can.",
    examples: [
      "Das Projekt, an dem ich arbeite, endet im Mai.",
      "Die Kollegin, mit der ich spreche, ist neu.",
      "Der Grund, aus dem er ging, war banal.",
    ],
    mistakes: [
      "*Das Projekt, das ich arbeite an → ..., an dem ich arbeite.",
      "*Die Kollegin, die ich mit spreche → ..., mit der ich spreche.",
    ],
    related: ["relative_clauses_nominative_accusative", "verbs_with_prepositions"],
    difficulty: 5,
  },
  {
    key: "konjunktiv_ii_present",
    explanation:
      "würde plus the infinitive covers most verbs. haben, sein and the modals keep their own forms, and using würde with them sounds clumsy: hätte, wäre, könnte, müsste.",
    examples: [
      "Ich würde gern länger bleiben.",
      "Wenn ich mehr Zeit hätte, würde ich reisen.",
      "An deiner Stelle wäre ich vorsichtig.",
    ],
    mistakes: [
      "*Ich würde mehr Zeit haben → Ich hätte mehr Zeit.",
      "*Wenn ich Zeit haben würde, würde ich reisen → Wenn ich Zeit hätte, würde ich reisen.",
    ],
    related: ["irreal_conditional_wenn", "konjunktiv_ii_politeness"],
    difficulty: 4,
  },
  {
    key: "irreal_conditional_wenn",
    explanation:
      "Both halves go into the Konjunktiv II. For something that did not happen in the past, use hätte or wäre plus the participle in both halves.",
    examples: [
      "Wenn ich reich wäre, würde ich ein Haus kaufen.",
      "Wenn du früher gegangen wärst, hättest du den Zug bekommen.",
      "Hätte ich das gewusst, wäre ich geblieben.",
    ],
    mistakes: [
      "*Wenn ich reich bin, würde ich ein Haus kaufen → Wenn ich reich wäre, ...",
      "*Wenn ich das gewusst hätte, hätte ich gekommen → ..., wäre ich gekommen.",
    ],
    related: ["konjunktiv_ii_present", "subordinate_clause_wenn"],
    difficulty: 5,
  },
  {
    key: "passive_with_von_durch",
    explanation:
      "von names who did it and takes the dative; durch names what caused or carried it and takes the accusative. Most passive sentences name neither, which is the point of using one.",
    examples: [
      "Das Formular wird von der Sachbearbeiterin geprüft.",
      "Die Stadt wurde durch das Hochwasser beschädigt.",
      "Der Vertrag wurde von beiden Seiten unterschrieben.",
    ],
    mistakes: [
      "*durch die Sachbearbeiterin geprüft → von der Sachbearbeiterin. A person takes von.",
      "*von dem Hochwasser beschädigt → durch das Hochwasser.",
    ],
    related: ["passive_present", "passive_past"],
  },
  {
    key: "passive_with_modals",
    explanation:
      "The modal is conjugated, the participle comes next and werden goes last in the infinitive. This is the standard form of every rule, deadline and instruction in German bureaucracy.",
    examples: [
      "Der Antrag muss bis Freitag eingereicht werden.",
      "Das kann online erledigt werden.",
      "Die Frist darf nicht überschritten werden.",
    ],
    mistakes: [
      "*Der Antrag muss werden eingereicht → muss eingereicht werden.",
      "*Der Antrag muss eingereicht sein, if you mean the act → eingereicht werden.",
    ],
    related: ["passive_present", "passive_past"],
    difficulty: 4,
  },
  {
    key: "passive_past",
    explanation:
      "wurde plus the participle in writing, or ist plus participle plus worden in speech. Note worden, not geworden: the passive drops the ge-.",
    examples: [
      "Der Bahnhof wurde 1998 umgebaut.",
      "Die Entscheidung ist gestern getroffen worden.",
      "Mir wurde nichts gesagt.",
    ],
    mistakes: [
      "*ist getroffen geworden → ist getroffen worden.",
      "*Der Bahnhof war umgebaut, meaning the event → Der Bahnhof wurde umgebaut.",
    ],
    related: ["passive_present", "passive_with_von_durch"],
    difficulty: 4,
  },
  {
    key: "indirect_speech_konjunktiv_i",
    explanation:
      "sei, habe, komme and so on report what someone said without endorsing it. Where the Konjunktiv I looks identical to the ordinary present, German falls back on the Konjunktiv II.",
    examples: [
      "Er sagt, er sei krank.",
      "Die Firma erklärte, sie habe nichts gewusst.",
      "Sie behauptet, sie komme später.",
    ],
    mistakes: [
      "*Er sagt, er ist krank, in a written report → er sei krank.",
      "*Sie sagen, sie haben nichts gewusst → sie hätten nichts gewusst.",
    ],
    related: ["reporting_verbs", "subordinate_clause_dass"],
    difficulty: 5,
  },
  {
    key: "reporting_verbs",
    explanation:
      "sagen, erklären, betonen, behaupten and bestreiten each carry a different degree of commitment. behaupten and angeblich signal that the speaker does not vouch for it.",
    examples: [
      "Er behauptet, davon nichts gewusst zu haben.",
      "Die Zeitung berichtet, der Umbau verzögere sich.",
      "Sie bestreitet jede Verantwortung.",
    ],
    mistakes: [
      "*Er sagt zu mir, dass ... → Er sagt mir, dass ... sagen takes a plain dative.",
      "*Er behauptet zu wissen nichts → Er behauptet, nichts zu wissen.",
    ],
    related: ["indirect_speech_konjunktiv_i", "infinitive_clauses_zu"],
  },
  {
    key: "nominalisation",
    explanation:
      "German turns verbs into nouns freely. A capitalised infinitive is always neuter: das Lesen, das Arbeiten. The -ung ending does the same job and is always feminine.",
    examples: [
      "das Arbeiten von zu Hause",
      "die Kündigung des Vertrags",
      "Beim Lesen schlafe ich ein.",
    ],
    mistakes: [
      "*die Arbeiten von zu Hause → das Arbeiten. A nominalised infinitive is neuter.",
      "*bei dem Lesen → beim Lesen.",
    ],
    related: ["genitive_case", "infinitive_clauses_zu"],
  },
  {
    key: "infinitive_clauses_zu",
    explanation:
      "zu plus the infinitive at the end of its clause, after verbs like vorhaben, vergessen and versuchen and after adjectives like wichtig and schwer. With a separable verb the zu sits inside: anzurufen.",
    examples: [
      "Ich habe vor, ein Semester in Wien zu studieren.",
      "Es ist wichtig, pünktlich zu sein.",
      "Sie hat vergessen, mich anzurufen.",
    ],
    mistakes: [
      "*Sie hat vergessen, mich zu anrufen → ..., mich anzurufen.",
      "*Ich habe vor zu studieren ein Semester → ..., ein Semester zu studieren.",
    ],
    related: ["purpose_clause_um_zu", "nominalisation"],
  },
  {
    key: "purpose_clause_um_zu",
    explanation:
      "um plus zu plus the infinitive states a purpose and has no subject of its own, so it only works when both halves share one. Otherwise the word is damit.",
    examples: [
      "Ich lerne Deutsch, um hier zu arbeiten.",
      "Um pünktlich zu sein, nehme ich den früheren Zug.",
      "Sie spart, um ein Auto zu kaufen.",
    ],
    mistakes: [
      "*Ich lerne Deutsch, um ich hier arbeite → ..., um hier zu arbeiten.",
      "*Ich spreche langsam, um du mich verstehst → ..., damit du mich verstehst.",
    ],
    related: ["subordinate_clause_damit", "infinitive_clauses_zu"],
  },
  {
    key: "conditional_clauses_falls",
    explanation:
      "falls and sofern mark a case that may well not arise, which is why they turn up in contracts and instructions. They behave exactly like wenn and send the verb to the end.",
    examples: [
      "Falls Sie Fragen haben, rufen Sie uns an.",
      "Sofern nichts dazwischenkommt, bin ich um sechs da.",
      "Falls der Vertrag gekündigt wird, entfällt die Gebühr.",
    ],
    mistakes: [
      "*Falls Sie Fragen haben, Sie rufen uns an → ..., rufen Sie uns an.",
      "*Falls, dass Sie Fragen haben → Falls Sie Fragen haben.",
    ],
    related: ["subordinate_clause_wenn", "irreal_conditional_wenn"],
  },
  {
    key: "comparative_structures_je_desto",
    explanation:
      "je plus a comparative sends its verb to the end; desto plus a comparative keeps its verb second. Two different word orders in one sentence, which is what makes it awkward.",
    examples: [
      "Je früher wir anfangen, desto besser.",
      "Je mehr ich lese, desto leichter fällt es mir.",
      "Je länger die Laufzeit, desto niedriger die Rate.",
    ],
    mistakes: [
      "*Je mehr ich lese, desto es fällt mir leichter → ..., desto leichter fällt es mir.",
      "*Je mehr ich lese, je leichter → ..., desto leichter.",
    ],
    related: ["comparative_forms", "superlative_forms"],
    difficulty: 4,
  },
  {
    key: "participles_as_adjectives",
    explanation:
      "Both participles can stand before a noun and then take ordinary adjective endings. The present participle in -end is active and ongoing; the past participle is finished or passive.",
    examples: [
      "die steigenden Preise",
      "ein gut ausgebautes Netz",
      "die betroffenen Anwohner",
    ],
    mistakes: [
      "*die steigende Preise → die steigenden Preise.",
      "*ein gut ausbauen Netz → ein gut ausgebautes Netz.",
    ],
    related: ["adjective_endings_definite", "passive_past"],
    difficulty: 4,
  },
  {
    key: "discourse_connectors",
    explanation:
      "zunächst, außerdem, einerseits and andererseits, abschließend. They tell a listener where they are in your argument, and each counts as the first element, so the verb follows.",
    examples: [
      "Zunächst möchte ich das Problem beschreiben.",
      "Andererseits gibt es auch Vorteile.",
      "Abschließend fasse ich kurz zusammen.",
    ],
    mistakes: [
      "*Zunächst ich möchte → Zunächst möchte ich.",
      "*Einerseits ist es teuer, und es ist langsam → pair einerseits with andererseits.",
    ],
    related: ["connectors_deshalb_trotzdem", "concessive_connectors", "word_order_main_clause"],
  },
  {
    key: "futur_ii",
    explanation:
      "werden plus the participle plus haben or sein. It rarely means the future: in practice it is how German guesses about something that has probably already happened.",
    examples: [
      "Er wird den Zug verpasst haben.",
      "Bis Freitag werden wir das erledigt haben.",
      "Sie wird schon angekommen sein.",
    ],
    mistakes: [
      "*Er wird den Zug verpasst → Er wird den Zug verpasst haben.",
      "*Er wird angekommen haben → Er wird angekommen sein.",
    ],
    related: ["future_with_werden", "perfekt_with_sein"],
    difficulty: 5,
  },
  {
    key: "repair_strategies",
    explanation:
      "The phrases that keep you in German when a word will not come: ask for it, talk around it, or buy a second. Reaching for English ends the practice; reaching for these does not.",
    examples: [
      "Wie sagt man das auf Deutsch?",
      "Ich meine so etwas wie einen Behälter für Papier.",
      "Moment, wie soll ich das sagen ...",
    ],
    mistakes: [
      "*Sorry, I mean ... → Entschuldigung, ich meine ...",
      "*Wie heißt das auf Deutsch?, for a whole phrase → Wie sagt man das auf Deutsch? heißen asks only for a name.",
    ],
    related: ["discourse_connectors"],
  },
];
