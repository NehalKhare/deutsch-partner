import type { GENDERS, PARTS_OF_SPEECH } from "@/domain/vocabulary";

/**
 * The lexicon: one entry for every word the curriculum targets.
 *
 * Tabular data written as tabular code. Six positional helpers keep an entry
 * to a line or two, because four hundred dictionary entries written as full
 * object literals would bury the content in punctuation. Every helper takes
 * its arguments in the same order — display form, then what a dictionary
 * would print: translation, German definition, an example sentence.
 *
 * The display form is what the curriculum names, article included. The lemma
 * is derived from it, so the two can never disagree: `der Bahnhof` yields
 * `Bahnhof`, `sich beschweren` yields `beschweren`.
 *
 * Definitions are in German on purpose. A learner at B1 should be able to read
 * the definition of a B1 word, and a monolingual definition is what the tutor
 * quotes when it explains a word without falling back to English.
 */

type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];
type Gender = (typeof GENDERS)[number];

export interface WordSeed {
  /** Exactly as the curriculum names it, article and all. */
  readonly word: string;
  readonly lemma: string;
  readonly partOfSpeech: PartOfSpeech;
  readonly gender: Gender | null;
  /** Null where the noun has no plural in ordinary use. */
  readonly plural: string | null;
  readonly english: string;
  readonly definition: string;
  readonly example: string;
}

const ARTICLES: readonly Gender[] = ["der", "die", "das"];

/** A noun: `der Bahnhof`, its plural, then the dictionary fields. */
function n(
  word: string,
  plural: string | null,
  english: string,
  definition: string,
  example: string,
): WordSeed {
  const [article, ...rest] = word.split(" ");
  const gender = ARTICLES.find((candidate) => candidate === article);

  if (!gender || rest.length === 0) {
    throw new Error(`noun must start with der, die or das: ${word}`);
  }

  return {
    word,
    lemma: rest.join(" "),
    partOfSpeech: "noun",
    gender,
    plural,
    english,
    definition,
    example,
  };
}

/** A verb. A leading `sich` is part of the word but not of the lemma. */
function v(
  word: string,
  english: string,
  definition: string,
  example: string,
): WordSeed {
  return {
    word,
    lemma: word.replace(/^sich /, ""),
    partOfSpeech: "verb",
    gender: null,
    plural: null,
    english,
    definition,
    example,
  };
}

/** Anything else, with its part of speech named. */
function w(
  word: string,
  partOfSpeech: Exclude<PartOfSpeech, "noun" | "verb">,
  english: string,
  definition: string,
  example: string,
): WordSeed {
  return {
    word,
    lemma: word,
    partOfSpeech,
    gender: null,
    plural: null,
    english,
    definition,
    example,
  };
}

const adj = (word: string, english: string, definition: string, example: string) =>
  w(word, "adjective", english, definition, example);
const adv = (word: string, english: string, definition: string, example: string) =>
  w(word, "adverb", english, definition, example);
const phrase = (word: string, english: string, definition: string, example: string) =>
  w(word, "phrase", english, definition, example);

export const LEXICON: readonly WordSeed[] = [
  // --- 1. Hallo und Tschüss ---
  w("hallo", "interjection", "hello", "Ein Gruß, wenn man jemanden trifft.", "Hallo, ich bin Nina."),
  phrase("guten Morgen", "good morning", "Ein Gruß am Vormittag.", "Guten Morgen, haben Sie gut geschlafen?"),
  w("tschüss", "interjection", "bye", "Ein Gruß, wenn man weggeht.", "Tschüss, bis morgen!"),
  n("der Name", "Namen", "name", "Das Wort, mit dem eine Person gerufen wird.", "Mein Name ist Jonas Weber."),
  v("heißen", "to be called", "Einen bestimmten Namen tragen.", "Wie heißt du?"),
  w("danke", "interjection", "thank you", "Ein Wort, mit dem man sich bedankt.", "Danke für deine Hilfe!"),

  // --- 2. Woher kommst du? ---
  v("kommen", "to come", "Sich zu einem Ort hin bewegen.", "Ich komme aus Indien."),
  w("aus", "preposition", "from", "Zeigt die Herkunft oder den Ausgangspunkt an.", "Sie kommt aus der Schweiz."),
  n("das Land", "Länder", "country", "Ein Staat mit eigenen Grenzen und einer Regierung.", "Welches Land möchtest du besuchen?"),
  n("die Sprache", "Sprachen", "language", "Das System aus Wörtern, mit dem Menschen sprechen.", "Deutsch ist eine schwere Sprache."),
  v("sprechen", "to speak", "Worte benutzen, um sich mitzuteilen.", "Ich spreche ein bisschen Deutsch."),
  v("wohnen", "to live", "An einem Ort zu Hause sein.", "Wir wohnen in Hamburg."),

  // --- 3. Zahlen und Kontakt ---
  n("die Zahl", "Zahlen", "number", "Ein Zeichen, mit dem man zählt oder rechnet.", "Die Zahl dreizehn bringt angeblich Unglück."),
  n("die Nummer", "Nummern", "number", "Eine Zahl, die etwas eindeutig bezeichnet.", "Sag mir bitte deine Nummer."),
  n("das Alter", null, "age", "Die Zahl der Jahre, die jemand schon lebt.", "In welchem Alter hast du Deutsch gelernt?"),
  v("buchstabieren", "to spell", "Ein Wort Buchstabe für Buchstabe sagen.", "Können Sie Ihren Nachnamen buchstabieren?"),
  n("die Adresse", "Adressen", "address", "Die Angabe, wo jemand wohnt oder arbeitet.", "Schreib mir bitte deine Adresse auf."),
  n("die E-Mail", "E-Mails", "email", "Eine Nachricht, die über das Internet verschickt wird.", "Ich schicke dir gleich eine E-Mail."),

  // --- 4. Der, die, das ---
  n("der Tisch", "Tische", "table", "Ein Möbelstück mit einer Platte auf Beinen.", "Das Buch liegt auf dem Tisch."),
  n("die Tür", "Türen", "door", "Der Teil einer Wand, den man öffnen kann.", "Mach bitte die Tür zu."),
  n("das Fenster", "Fenster", "window", "Die Öffnung in einer Wand, durch die Licht kommt.", "Das Fenster steht offen."),
  n("der Stuhl", "Stühle", "chair", "Ein Möbelstück für eine Person zum Sitzen.", "Nimm dir einen Stuhl."),
  n("die Tasche", "Taschen", "bag", "Ein Behälter, den man bei sich trägt.", "Meine Tasche ist viel zu schwer."),
  n("das Buch", "Bücher", "book", "Viele bedruckte Seiten in einem Einband.", "Ich lese gerade ein spannendes Buch."),

  // --- 5. Ich habe kein Geld ---
  v("haben", "to have", "Etwas besitzen oder bei sich tragen.", "Ich habe heute keine Zeit."),
  v("brauchen", "to need", "Etwas nötig haben.", "Wir brauchen noch Milch."),
  n("das Handy", "Handys", "mobile phone", "Ein kleines Telefon, das man überallhin mitnimmt.", "Mein Handy ist schon wieder leer."),
  n("der Schlüssel", "Schlüssel", "key", "Ein Gegenstand, mit dem man ein Schloss öffnet.", "Ich habe meinen Schlüssel vergessen."),
  n("das Geld", null, "money", "Münzen und Scheine, mit denen man bezahlt.", "Für ein neues Fahrrad fehlt mir das Geld."),
  w("kein", "article", "no, not any", "Verneint ein Substantiv.", "Ich habe kein Geld dabei."),

  // --- 6. Meine Familie ---
  n("die Mutter", "Mütter", "mother", "Die weibliche Person, die ein Kind bekommen hat.", "Meine Mutter kommt aus Polen."),
  n("der Vater", "Väter", "father", "Die männliche Person, von der ein Kind abstammt.", "Mein Vater arbeitet als Lehrer."),
  n("die Schwester", "Schwestern", "sister", "Ein weibliches Kind derselben Eltern.", "Meine Schwester ist zwei Jahre älter."),
  n("der Bruder", "Brüder", "brother", "Ein männliches Kind derselben Eltern.", "Mein Bruder studiert in Leipzig."),
  n("die Eltern", null, "parents", "Mutter und Vater zusammen.", "Meine Eltern wohnen noch im selben Haus."),
  adj("verheiratet", "married", "In einer Ehe lebend.", "Sie ist seit zehn Jahren verheiratet."),

  // --- 7. Was machst du gern? ---
  adv("gern", "gladly, with pleasure", "Zeigt, dass man etwas mag.", "Ich koche sehr gern."),
  v("spielen", "to play", "Etwas zum Vergnügen oder nach Regeln tun.", "Am Wochenende spielen wir Fußball."),
  v("lesen", "to read", "Geschriebene Wörter verstehen.", "Abends lese ich eine halbe Stunde."),
  v("hören", "to hear, to listen", "Etwas mit den Ohren wahrnehmen.", "Ich höre gern Podcasts auf Deutsch."),
  n("das Hobby", "Hobbys", "hobby", "Etwas, das man in der Freizeit gern macht.", "Klettern ist mein liebstes Hobby."),
  n("die Freizeit", null, "free time", "Die Zeit, in der man nicht arbeiten muss.", "In meiner Freizeit fahre ich Rad."),

  // --- 8. Im Café ---
  n("der Kaffee", "Kaffees", "coffee", "Ein heißes Getränk aus gerösteten Bohnen.", "Einen Kaffee mit Milch, bitte."),
  n("das Wasser", null, "water", "Die klare Flüssigkeit, die man trinkt.", "Bringen Sie uns bitte noch Wasser."),
  v("bestellen", "to order", "Sagen, was man haben möchte.", "Wir haben schon vor zehn Minuten bestellt."),
  n("die Rechnung", "Rechnungen", "bill", "Das Papier, auf dem steht, was man zahlen muss.", "Die Rechnung, bitte."),
  v("zahlen", "to pay", "Geld für etwas geben.", "Ich zahle mit Karte."),
  w("bitte", "interjection", "please", "Macht eine Bitte höflich.", "Einen Tee, bitte."),

  // --- 9. Einkaufen ---
  v("kaufen", "to buy", "Etwas gegen Geld bekommen.", "Ich kaufe das Brot beim Bäcker."),
  n("der Preis", "Preise", "price", "Das Geld, das etwas kostet.", "Der Preis ist mir zu hoch."),
  adj("teuer", "expensive", "Viel Geld kostend.", "Die Wohnung ist sehr teuer."),
  adj("billig", "cheap", "Wenig Geld kostend.", "Hier ist das Obst billiger."),
  n("das Kilo", "Kilo", "kilo", "Eine Einheit für das Gewicht, tausend Gramm.", "Ich nehme ein Kilo Äpfel."),
  n("die Flasche", "Flaschen", "bottle", "Ein hoher Behälter für Getränke.", "Eine Flasche Wasser kostet einen Euro."),

  // --- 10. Mein Tag ---
  v("aufstehen", "to get up", "Das Bett verlassen.", "Unter der Woche stehe ich um sechs auf."),
  n("die Uhr", "Uhren", "clock, watch", "Ein Gerät, das die Zeit anzeigt.", "Meine Uhr geht zwei Minuten vor."),
  adj("früh", "early", "Am Anfang eines Zeitraums.", "Morgen muss ich früh raus."),
  adj("spät", "late", "Nach der erwarteten Zeit.", "Es ist schon spät geworden."),
  n("das Frühstück", "Frühstücke", "breakfast", "Die erste Mahlzeit am Morgen.", "Zum Frühstück esse ich nur ein Brot."),
  v("arbeiten", "to work", "Eine Tätigkeit gegen Bezahlung ausüben.", "Ich arbeite von zu Hause aus."),

  // --- 11. In der Stadt ---
  n("die Straße", "Straßen", "street", "Der Weg, auf dem Autos fahren.", "Die Straße ist heute gesperrt."),
  adv("links", "left", "Auf der Seite des Herzens.", "An der Ampel gehen Sie links."),
  adv("rechts", "right", "Auf der Seite gegenüber von links.", "Das Museum liegt rechts."),
  adv("geradeaus", "straight ahead", "Ohne abzubiegen weiter.", "Gehen Sie immer geradeaus."),
  n("die Haltestelle", "Haltestellen", "stop", "Der Ort, an dem Bus oder Bahn hält.", "Die Haltestelle ist gleich um die Ecke."),
  v("fragen", "to ask", "Eine Frage stellen, um etwas zu erfahren.", "Frag doch einfach jemanden."),

  // --- 12. Meine Wohnung ---
  n("die Wohnung", "Wohnungen", "flat, apartment", "Mehrere Räume, in denen jemand wohnt.", "Unsere Wohnung hat drei Zimmer."),
  n("das Zimmer", "Zimmer", "room", "Ein einzelner Raum in einer Wohnung.", "Das Zimmer ist hell und ruhig."),
  n("die Küche", "Küchen", "kitchen", "Der Raum, in dem gekocht wird.", "Wir sitzen meistens in der Küche."),
  n("das Bett", "Betten", "bed", "Das Möbelstück, in dem man schläft.", "Das Bett steht am Fenster."),
  adj("gemütlich", "cosy", "Angenehm und zum Bleiben einladend.", "Euer Wohnzimmer ist sehr gemütlich."),
  v("mieten", "to rent", "Für Geld zeitweise benutzen dürfen.", "Wir mieten die Wohnung seit drei Jahren."),

  // --- 13. Das Wochenende ---
  adv("gestern", "yesterday", "Am Tag vor heute.", "Gestern war ich im Kino."),
  n("das Wochenende", "Wochenenden", "weekend", "Samstag und Sonntag zusammen.", "Was hast du am Wochenende gemacht?"),
  v("treffen", "to meet", "Mit jemandem zusammenkommen.", "Wir treffen uns um acht am Bahnhof."),
  v("besuchen", "to visit", "Zu jemandem oder etwas hingehen.", "Am Sonntag besuche ich meine Großmutter."),
  v("kochen", "to cook", "Essen mit Hitze zubereiten.", "Heute koche ich etwas Indisches."),
  n("der Film", "Filme", "film", "Eine Geschichte in bewegten Bildern.", "Der Film hat mir gut gefallen."),

  // --- 14. Unterwegs ---
  v("fahren", "to go, to drive", "Sich mit einem Fahrzeug fortbewegen.", "Ich fahre morgen nach Köln."),
  v("fliegen", "to fly", "Sich durch die Luft fortbewegen.", "Wir fliegen im Juli nach Lissabon."),
  n("der Zug", "Züge", "train", "Ein langes Fahrzeug, das auf Schienen fährt.", "Der Zug hat zwanzig Minuten Verspätung."),
  n("der Bahnhof", "Bahnhöfe", "station", "Der Ort, an dem Züge halten.", "Wir treffen uns vor dem Bahnhof."),
  v("ankommen", "to arrive", "Am Ziel eintreffen.", "Wann kommt ihr in Berlin an?"),
  n("die Reise", "Reisen", "journey", "Eine Fahrt an einen weiter entfernten Ort.", "Die Reise hat elf Stunden gedauert."),

  // --- 15. Wie geht es dir? ---
  adj("müde", "tired", "Ohne Kraft und mit dem Wunsch zu schlafen.", "Nach der Arbeit bin ich immer müde."),
  adj("krank", "ill", "Nicht gesund.", "Mein Sohn ist seit gestern krank."),
  v("können", "can, to be able to", "Etwas tun dürfen oder beherrschen.", "Ich kann leider nicht kommen."),
  v("müssen", "must, to have to", "Etwas unbedingt tun sollen.", "Ich muss heute länger arbeiten."),
  n("der Termin", "Termine", "appointment", "Eine feste Zeit für eine Verabredung.", "Ich habe morgen einen Termin beim Zahnarzt."),
  v("helfen", "to help", "Jemanden bei etwas unterstützen.", "Kannst du mir kurz helfen?"),

  // --- 16. Verabredungen ---
  v("sich verabreden", "to arrange to meet", "Mit jemandem eine Zeit und einen Ort ausmachen.", "Wir haben uns für Freitag verabredet."),
  v("absagen", "to cancel", "Etwas Vereinbartes nicht stattfinden lassen.", "Ich muss den Termin leider absagen."),
  v("verschieben", "to postpone", "Auf einen späteren Zeitpunkt legen.", "Können wir das Treffen auf Montag verschieben?"),
  n("der Vorschlag", "Vorschläge", "suggestion", "Eine Idee, die man anderen zur Auswahl anbietet.", "Dein Vorschlag gefällt mir."),
  v("passen", "to suit, to fit", "Für jemanden oder etwas geeignet sein.", "Passt dir Dienstag um sieben?"),
  adv("leider", "unfortunately", "Drückt aus, dass etwas bedauerlich ist.", "Leider habe ich schon etwas vor."),

  // --- 17. Beim Arzt ---
  n("die Schmerzen", null, "pain", "Das unangenehme Gefühl bei einer Verletzung oder Krankheit.", "Ich habe seit Tagen Schmerzen im Rücken."),
  n("das Rezept", "Rezepte", "prescription", "Das Papier, mit dem man ein Medikament bekommt.", "Der Arzt hat mir ein Rezept ausgestellt."),
  n("die Praxis", "Praxen", "surgery, practice", "Die Räume, in denen eine Ärztin arbeitet.", "Die Praxis ist mittwochs geschlossen."),
  v("wehtun", "to hurt", "Schmerzen verursachen.", "Mein Knie tut beim Laufen weh."),
  n("die Erkältung", "Erkältungen", "cold", "Eine leichte Krankheit mit Husten und Schnupfen.", "Ich habe mir eine Erkältung geholt."),
  v("sich fühlen", "to feel", "In einem bestimmten körperlichen Zustand sein.", "Heute fühle ich mich schon besser."),

  // --- 18. Wohnungssuche ---
  n("die Miete", "Mieten", "rent", "Das Geld, das man monatlich für eine Wohnung zahlt.", "Die Miete ist im letzten Jahr gestiegen."),
  n("die Anzeige", "Anzeigen", "advert", "Ein kurzer Text, mit dem etwas angeboten wird.", "Ich habe die Anzeige im Internet gefunden."),
  n("die Besichtigung", "Besichtigungen", "viewing", "Der Termin, bei dem man sich etwas ansieht.", "Zur Besichtigung kamen dreißig Leute."),
  n("der Vermieter", "Vermieter", "landlord", "Die Person, der die Wohnung gehört.", "Der Vermieter wohnt im selben Haus."),
  n("die Kaution", "Kautionen", "deposit", "Das Geld, das man als Sicherheit hinterlegt.", "Die Kaution beträgt drei Monatsmieten."),
  adj("hell", "bright", "Von viel Licht erfüllt.", "Das Schlafzimmer ist angenehm hell."),

  // --- 19. Umziehen ---
  n("der Umzug", "Umzüge", "move", "Der Wechsel in eine andere Wohnung.", "Der Umzug hat den ganzen Samstag gedauert."),
  n("das Regal", "Regale", "shelf", "Ein Möbelstück mit Brettern für Bücher oder Geschirr.", "Das Regal passt genau in die Ecke."),
  v("stellen", "to put, to stand", "Etwas aufrecht an einen Platz bringen.", "Stell die Flaschen bitte in die Küche."),
  v("legen", "to lay", "Etwas flach an einen Platz bringen.", "Leg die Handtücher ins Regal."),
  v("hängen", "to hang", "Etwas so anbringen, dass es herunterhängt.", "Wir hängen das Bild über das Sofa."),
  n("der Schrank", "Schränke", "cupboard, wardrobe", "Ein hohes Möbelstück mit Türen.", "Im Schrank ist kein Platz mehr."),

  // --- 20. Reisen planen ---
  n("der Aufenthalt", "Aufenthalte", "stay", "Die Zeit, die man an einem Ort verbringt.", "Unser Aufenthalt in Wien war zu kurz."),
  v("buchen", "to book", "Etwas fest reservieren.", "Ich habe das Hotel schon gebucht."),
  n("das Wetter", null, "weather", "Der Zustand von Sonne, Regen und Wind.", "Das Wetter soll am Wochenende besser werden."),
  n("der Regen", null, "rain", "Wasser, das aus den Wolken fällt.", "Bei dem Regen bleibe ich lieber zu Hause."),
  adj("sonnig", "sunny", "Mit viel Sonne.", "Morgen wird es sonnig und warm."),
  v("packen", "to pack", "Sachen in eine Tasche oder einen Koffer tun.", "Ich packe immer erst am Abend vorher."),

  // --- 21. Am Bahnhof ---
  n("die Verspätung", "Verspätungen", "delay", "Die Zeit, um die etwas zu spät kommt.", "Der Zug hat vierzig Minuten Verspätung."),
  v("umsteigen", "to change trains", "Von einem Verkehrsmittel in ein anderes wechseln.", "In Hannover müssen Sie umsteigen."),
  n("der Anschluss", "Anschlüsse", "connection", "Der nächste Zug, den man noch erreichen soll.", "Ich habe meinen Anschluss verpasst."),
  n("das Gleis", "Gleise", "platform, track", "Die Schienen, an denen der Zug hält.", "Der Zug fährt heute von Gleis sieben."),
  n("die Auskunft", "Auskünfte", "information", "Eine Antwort auf eine Frage nach Informationen.", "Am Schalter bekommen Sie eine Auskunft."),
  v("verpassen", "to miss", "Zu spät kommen und etwas nicht erreichen.", "Wenn wir jetzt gehen, verpassen wir nichts."),

  // --- 22. Mit Bus und Bahn ---
  n("die Fahrkarte", "Fahrkarten", "ticket", "Das Papier, das zur Fahrt berechtigt.", "Eine Fahrkarte nach Bremen, bitte."),
  n("die Linie", "Linien", "line", "Die feste Strecke eines Busses oder einer Bahn.", "Nimm die Linie acht Richtung Hauptbahnhof."),
  n("der Fahrplan", "Fahrpläne", "timetable", "Die Übersicht, wann welches Fahrzeug fährt.", "Der neue Fahrplan gilt ab Dezember."),
  adj("gültig", "valid", "So, dass es benutzt werden darf.", "Die Karte ist nur bis Mitternacht gültig."),
  v("einsteigen", "to get on", "In ein Fahrzeug hineingehen.", "Bitte hinten einsteigen."),
  v("aussteigen", "to get off", "Ein Fahrzeug verlassen.", "Wir steigen an der nächsten Haltestelle aus."),

  // --- 23. Arbeit und Beruf ---
  n("der Beruf", "Berufe", "profession", "Die Tätigkeit, mit der jemand sein Geld verdient.", "Was sind Sie von Beruf?"),
  n("die Kollegin", "Kolleginnen", "colleague", "Eine Frau, mit der man zusammenarbeitet.", "Meine Kollegin übernimmt das Projekt."),
  n("die Besprechung", "Besprechungen", "meeting", "Ein Treffen, bei dem etwas geklärt wird.", "Die Besprechung dauert bis elf."),
  v("verdienen", "to earn", "Geld für seine Arbeit bekommen.", "In der Pflege verdient man zu wenig."),
  n("die Aufgabe", "Aufgaben", "task", "Etwas, das jemand erledigen soll.", "Diese Aufgabe übernehme ich gern."),
  adj("selbstständig", "self-employed, independent", "Ohne Anweisung oder ohne festen Arbeitgeber.", "Seit zwei Jahren bin ich selbstständig."),

  // --- 24. Die Bewerbung ---
  n("die Bewerbung", "Bewerbungen", "application", "Die Unterlagen, mit denen man sich um eine Stelle bemüht.", "Meine Bewerbung ist gestern rausgegangen."),
  n("der Lebenslauf", "Lebensläufe", "CV", "Die Übersicht über Ausbildung und bisherige Arbeit.", "Der Lebenslauf soll zwei Seiten nicht überschreiten."),
  n("die Stelle", "Stellen", "position", "Ein Arbeitsplatz in einem Betrieb.", "Die Stelle ist ab Mai frei."),
  n("die Erfahrung", "Erfahrungen", "experience", "Das Wissen, das man durch Praxis bekommt.", "Ich habe drei Jahre Erfahrung im Verkauf."),
  v("sich bewerben", "to apply", "Sich um eine Stelle bemühen.", "Ich bewerbe mich auf die Stelle in Dresden."),
  n("der Anhang", "Anhänge", "attachment", "Die Datei, die man mit einer E-Mail schickt.", "Die Zeugnisse finden Sie im Anhang."),

  // --- 25. Feste und Feiern ---
  n("die Einladung", "Einladungen", "invitation", "Die Bitte, zu einem Fest zu kommen.", "Danke für die Einladung zur Hochzeit."),
  v("feiern", "to celebrate", "Ein Fest begehen.", "Wir feiern heute Abend bei uns im Garten."),
  n("das Geschenk", "Geschenke", "present", "Etwas, das man jemandem ohne Bezahlung gibt.", "Ich habe noch kein Geschenk für sie."),
  n("der Geburtstag", "Geburtstage", "birthday", "Der Jahrestag, an dem jemand geboren wurde.", "Sie hat am Freitag Geburtstag."),
  v("gratulieren", "to congratulate", "Jemandem Glück zu einem Anlass wünschen.", "Ich gratuliere dir herzlich!"),
  n("das Fest", "Feste", "celebration", "Eine größere Feier mit vielen Gästen.", "Das Fest dauerte bis zum Morgen."),

  // --- 26. Kleidung ---
  n("die Jacke", "Jacken", "jacket", "Ein Kleidungsstück für draußen mit Ärmeln.", "Zieh dir eine Jacke an, es ist kalt."),
  n("die Größe", "Größen", "size", "Das Maß, in dem Kleidung verkauft wird.", "Haben Sie das auch in Größe achtunddreißig?"),
  v("anprobieren", "to try on", "Kleidung anziehen, um zu sehen, ob sie passt.", "Darf ich die Hose kurz anprobieren?"),
  adj("eng", "tight", "Zu wenig Platz lassend.", "Die Schuhe sind mir zu eng."),
  adj("gestreift", "striped", "Mit Streifen gemustert.", "Er trägt fast immer gestreifte Hemden."),
  adj("bequem", "comfortable", "Angenehm zu tragen oder zu benutzen.", "Diese Schuhe sind wirklich bequem."),

  // --- 27. Umtausch und Reklamation ---
  v("umtauschen", "to exchange", "Gekaufte Ware gegen eine andere tauschen.", "Kann ich den Pullover umtauschen?"),
  n("der Kassenbon", "Kassenbons", "receipt", "Der Zettel, der den Kauf beweist.", "Ohne Kassenbon geht das leider nicht."),
  adj("kaputt", "broken", "Nicht mehr ganz oder nicht mehr funktionierend.", "Der Reißverschluss ist schon kaputt."),
  v("reklamieren", "to complain about", "Einen Mangel beim Verkäufer melden.", "Ich möchte diese Lampe reklamieren."),
  n("die Garantie", "Garantien", "warranty", "Das Versprechen, einen Fehler kostenlos zu beheben.", "Auf das Gerät sind zwei Jahre Garantie."),
  v("zurückgeben", "to return", "Etwas dem Besitzer wieder aushändigen.", "Ich gebe die Jacke morgen zurück."),

  // --- 28. Im Restaurant ---
  n("die Speisekarte", "Speisekarten", "menu", "Die Liste der Gerichte, die es gibt.", "Können wir bitte die Speisekarte haben?"),
  n("die Vorspeise", "Vorspeisen", "starter", "Das kleine Gericht vor dem Hauptgericht.", "Als Vorspeise nehme ich die Suppe."),
  n("das Hauptgericht", "Hauptgerichte", "main course", "Das größte Gericht einer Mahlzeit.", "Das Hauptgericht kam viel zu spät."),
  adj("salzig", "salty", "Mit viel Salz.", "Die Soße ist mir zu salzig."),
  v("empfehlen", "to recommend", "Jemandem zu etwas raten.", "Was können Sie uns empfehlen?"),
  adj("satt", "full", "So, dass man nichts mehr essen möchte.", "Danke, ich bin schon satt."),

  // --- 29. Medien und Internet ---
  n("das Konto", "Konten", "account", "Der persönliche Zugang zu einem Dienst.", "Mein Konto wurde ohne Grund gesperrt."),
  v("hochladen", "to upload", "Eine Datei ins Internet stellen.", "Ich lade die Fotos heute Abend hoch."),
  v("sich anmelden", "to log in, to register", "Sich mit seinen Daten Zugang verschaffen.", "Melde dich zuerst mit deiner E-Mail an."),
  n("die Nachricht", "Nachrichten", "message", "Ein kurzer Text, den man jemandem schickt.", "Ich habe dir eine Nachricht geschickt."),
  v("löschen", "to delete", "Etwas endgültig entfernen.", "Diese Datei kannst du ruhig löschen."),
  n("das Passwort", "Passwörter", "password", "Das geheime Wort, mit dem man sich ausweist.", "Wähl bitte ein längeres Passwort."),

  // --- 30. Freundschaft ---
  v("sich streiten", "to argue", "Heftig anderer Meinung sein.", "Wir haben uns wegen einer Kleinigkeit gestritten."),
  v("sich vertragen", "to make up", "Nach einem Streit wieder friedlich sein.", "Am nächsten Tag haben wir uns wieder vertragen."),
  v("vertrauen", "to trust", "Sicher sein, dass jemand einen nicht enttäuscht.", "Ihr kann ich blind vertrauen."),
  n("die Beziehung", "Beziehungen", "relationship", "Die Verbindung zwischen zwei Menschen.", "Unsere Beziehung ist enger geworden."),
  v("sich freuen", "to be pleased", "Ein schönes Gefühl über etwas haben.", "Ich freue mich schon auf den Sommer."),
  adj("enttäuscht", "disappointed", "Traurig, weil eine Erwartung nicht erfüllt wurde.", "Er war sichtlich enttäuscht."),

  // --- 31. Damals ---
  adv("damals", "back then", "Zu einer bestimmten Zeit in der Vergangenheit.", "Damals gab es hier noch Felder."),
  adv("früher", "in the past", "In einer Zeit, die lange zurückliegt.", "Früher bin ich jeden Tag geschwommen."),
  n("das Erlebnis", "Erlebnisse", "experience", "Etwas Besonderes, das jemandem passiert ist.", "Das war ein Erlebnis, das ich nie vergesse."),
  adv("plötzlich", "suddenly", "Ganz ohne Vorwarnung.", "Plötzlich ging das Licht aus."),
  n("der Unfall", "Unfälle", "accident", "Ein plötzliches Ereignis, bei dem Schaden entsteht.", "Nach dem Unfall war die Straße gesperrt."),
  v("erzählen", "to tell", "Jemandem berichten, was passiert ist.", "Erzähl mal, wie war der Urlaub?"),

  // --- 32. Stadt oder Land? ---
  n("die Gegend", "Gegenden", "area", "Ein Gebiet mit einem eigenen Charakter.", "Die Gegend hier ist sehr grün."),
  adj("ruhig", "quiet", "Ohne störenden Lärm.", "Die Straße ist nachts ganz ruhig."),
  n("der Verkehr", null, "traffic", "Alle Fahrzeuge, die unterwegs sind.", "Der Verkehr steht schon wieder."),
  n("der Nachteil", "Nachteile", "disadvantage", "Ein Punkt, der gegen etwas spricht.", "Der einzige Nachteil ist der weite Weg."),
  n("der Vorteil", "Vorteile", "advantage", "Ein Punkt, der für etwas spricht.", "Der Vorteil ist die günstige Miete."),
  v("sich lohnen", "to be worth it", "Den Aufwand wert sein.", "Der frühe Zug lohnt sich wirklich."),

  // --- 33. Umwelt im Alltag ---
  n("der Müll", null, "rubbish", "Alles, was weggeworfen wird.", "Der Müll wird dienstags abgeholt."),
  v("trennen", "to separate", "Dinge voneinander getrennt halten.", "In Deutschland trennt man den Müll."),
  v("sparen", "to save", "Weniger verbrauchen oder Geld zurücklegen.", "So sparen wir jeden Monat dreißig Euro."),
  n("die Verpackung", "Verpackungen", "packaging", "Das Material, in dem eine Ware verkauft wird.", "Die Verpackung ist größer als der Inhalt."),
  n("der Strom", null, "electricity", "Die Energie, die aus der Steckdose kommt.", "Der Strom ist deutlich teurer geworden."),
  v("vermeiden", "to avoid", "Dafür sorgen, dass etwas nicht passiert.", "Plastik lässt sich nicht ganz vermeiden."),

  // --- 34. Gesundheit und Sport ---
  v("sich bewegen", "to move, to exercise", "Den Körper aktiv benutzen.", "Ich bewege mich viel zu wenig."),
  n("die Ernährung", null, "diet, nutrition", "Die Art, wie sich jemand ernährt.", "Eine gesunde Ernährung ist keine Diät."),
  n("der Muskel", "Muskeln", "muscle", "Das Gewebe, mit dem sich der Körper bewegt.", "Nach dem Training tut jeder Muskel weh."),
  adj("regelmäßig", "regular", "In gleichen Abständen wiederkehrend.", "Er geht regelmäßig zum Schwimmen."),
  n("die Gewohnheit", "Gewohnheiten", "habit", "Etwas, das jemand immer wieder gleich macht.", "Alte Gewohnheiten ändert man nur langsam."),
  v("abnehmen", "to lose weight", "Weniger wiegen als vorher.", "Sie hat ohne Diät abgenommen."),

  // --- 35. A2 im Gespräch ---
  adv("eigentlich", "actually", "Zeigt, wie es genau genommen ist.", "Eigentlich wollte ich früher gehen."),
  adv("trotzdem", "nevertheless", "Obwohl etwas dagegen spricht.", "Es regnete, trotzdem sind wir gelaufen."),
  adv("deswegen", "for that reason", "Nennt den Grund für das Folgende.", "Der Zug fiel aus, deswegen kam ich zu spät."),
  adv("zuerst", "first", "Als Erstes in einer Reihenfolge.", "Zuerst erzähle ich, wie es angefangen hat."),
  adv("schließlich", "in the end", "Am Ende einer Entwicklung.", "Schließlich haben wir doch noch bestellt."),
  adv("außerdem", "besides", "Zusätzlich zu dem schon Gesagten.", "Es war teuer, außerdem hat es lange gedauert."),

  // --- 36. Meine Meinung ---
  n("die Meinung", "Meinungen", "opinion", "Das, was jemand über eine Sache denkt.", "Ich teile deine Meinung nicht ganz."),
  v("behaupten", "to claim", "Etwas als wahr hinstellen, ohne es zu beweisen.", "Er behauptet, davon nichts gewusst zu haben."),
  adj("überzeugt", "convinced", "Ganz sicher, dass etwas stimmt.", "Sie ist überzeugt, das Richtige zu tun."),
  n("das Argument", "Argumente", "argument", "Ein Grund, der eine Meinung stützt.", "Dein Argument hat mich überzeugt."),
  v("begründen", "to justify", "Sagen, warum man etwas meint oder tut.", "Kannst du das etwas genauer begründen?"),
  n("der Standpunkt", "Standpunkte", "point of view", "Die Sicht, aus der jemand urteilt.", "Aus ihrem Standpunkt ist das verständlich."),

  // --- 37. Zustimmen und widersprechen ---
  v("zustimmen", "to agree", "Dieselbe Meinung äußern.", "Da stimme ich dir voll zu."),
  v("widersprechen", "to contradict", "Deutlich das Gegenteil behaupten.", "Ich muss dir in einem Punkt widersprechen."),
  adv("teilweise", "partly", "Nur zu einem Teil.", "Das stimmt nur teilweise."),
  n("der Einwand", "Einwände", "objection", "Ein Grund, der gegen etwas spricht.", "Gegen den Plan gibt es einen Einwand."),
  phrase("im Gegenteil", "on the contrary", "Leitet die genau gegenteilige Aussage ein.", "Es war nicht langweilig, im Gegenteil."),
  v("zugeben", "to admit", "Etwas eingestehen, das gegen einen spricht.", "Ich gebe zu, dass ich mich geirrt habe."),

  // --- 38. Erlebnisse erzählen ---
  n("der Zwischenfall", "Zwischenfälle", "incident", "Ein unerwartetes Ereignis, das den Ablauf stört.", "Bis auf einen kleinen Zwischenfall lief alles gut."),
  adv("ausgerechnet", "of all things", "Betont, dass gerade dieser Fall ungünstig ist.", "Ausgerechnet an dem Tag streikte die Bahn."),
  adv("zufällig", "by chance", "Ohne Absicht oder Planung.", "Wir haben uns zufällig im Zug getroffen."),
  w("nachdem", "conjunction", "after", "Sagt, dass etwas zeitlich davor passiert ist.", "Nachdem wir gegessen hatten, gingen wir los."),
  adv("inzwischen", "meanwhile, by now", "In der Zeit dazwischen oder mittlerweile.", "Inzwischen wohnt sie wieder in München."),
  v("sich herausstellen", "to turn out", "Sich später als wahr zeigen.", "Es stellte sich heraus, dass niemand Bescheid wusste."),

  // --- 39. Wen meinst du? ---
  n("die Eigenschaft", "Eigenschaften", "quality, trait", "Ein Merkmal, das jemanden oder etwas kennzeichnet.", "Geduld ist ihre größte Eigenschaft."),
  adj("zuverlässig", "reliable", "So, dass man sich darauf verlassen kann.", "Er ist der zuverlässigste Kollege im Team."),
  v("auffallen", "to stand out", "Bemerkt werden, weil man anders ist.", "Mir ist aufgefallen, dass sie kaum spricht."),
  v("beschreiben", "to describe", "In Worten sagen, wie etwas ist.", "Beschreib mir bitte, wie er aussah."),
  adj("typisch", "typical", "Für jemanden oder etwas kennzeichnend.", "Das ist typisch für ihn."),
  n("der Eindruck", "Eindrücke", "impression", "Das Bild, das jemand von etwas bekommt.", "Ich hatte den Eindruck, dass sie müde war."),

  // --- 40. Genauer beschreiben ---
  n("der Zusammenhang", "Zusammenhänge", "connection, context", "Die Verbindung zwischen zwei Dingen.", "Zwischen beiden Fällen gibt es keinen Zusammenhang."),
  v("betreffen", "to concern", "Für jemanden oder etwas von Bedeutung sein.", "Die Änderung betrifft nur Neukunden."),
  v("erwähnen", "to mention", "Etwas kurz ansprechen.", "Sie hat das Problem nur kurz erwähnt."),
  n("die Einzelheit", "Einzelheiten", "detail", "Ein kleiner Teil einer größeren Sache.", "Die Einzelheiten klären wir später."),
  v("hinweisen", "to point out", "Jemanden auf etwas aufmerksam machen.", "Ich möchte auf einen Punkt hinweisen."),
  adv("jeweils", "in each case", "Für jeden einzelnen Fall gesondert.", "Die Kurse dauern jeweils zwei Stunden."),

  // --- 41. Wünsche und Hypothesen ---
  n("der Wunsch", "Wünsche", "wish", "Etwas, das sich jemand sehr erhofft.", "Mein größter Wunsch ist eine eigene Werkstatt."),
  v("sich vorstellen", "to imagine", "Sich ein Bild von etwas im Kopf machen.", "Ich könnte mir gut vorstellen, dort zu leben."),
  phrase("an deiner Stelle", "if I were you", "Leitet einen Rat aus der Sicht des anderen ein.", "An deiner Stelle würde ich noch warten."),
  n("das Glück", null, "luck, happiness", "Ein günstiger Zufall oder ein tiefes Wohlgefühl.", "Zum Glück war noch ein Platz frei."),
  v("riskieren", "to risk", "Etwas tun, obwohl es schiefgehen kann.", "So viel würde ich nicht riskieren."),
  adv("beinahe", "almost", "Fast, aber eben doch nicht.", "Ich hätte beinahe den Zug verpasst."),

  // --- 42. Höflich bitten ---
  n("die Bitte", "Bitten", "request", "Der höfliche Wunsch, dass jemand etwas tut.", "Ich hätte eine Bitte an Sie."),
  v("sich beschweren", "to complain", "Offiziell sagen, dass etwas nicht in Ordnung ist.", "Wir haben uns schriftlich beschwert."),
  n("das Anliegen", "Anliegen", "concern, request", "Die Sache, um die es jemandem geht.", "Was ist Ihr Anliegen?"),
  adj("dringend", "urgent", "So, dass es keinen Aufschub duldet.", "Die Sache ist wirklich dringend."),
  v("bedauern", "to regret", "Es schade finden, dass etwas so ist.", "Wir bedauern die Verzögerung sehr."),
  v("entgegenkommen", "to accommodate", "Jemandem in einem Punkt nachgeben.", "Der Vermieter ist uns beim Termin entgegengekommen."),

  // --- 43. Wie etwas gemacht wird ---
  n("der Vorgang", "Vorgänge", "process", "Das, was nacheinander abläuft.", "Der ganze Vorgang dauert drei Minuten."),
  v("herstellen", "to produce", "Eine Ware anfertigen.", "Das Papier wird hier vor Ort hergestellt."),
  v("verarbeiten", "to process", "Ein Material weiterbearbeiten.", "Die Milch wird zu Käse verarbeitet."),
  n("der Ablauf", "Abläufe", "procedure", "Die Reihenfolge der einzelnen Schritte.", "Den Ablauf erkläre ich Ihnen kurz."),
  v("prüfen", "to check", "Kontrollieren, ob etwas stimmt.", "Jedes Teil wird einzeln geprüft."),
  v("liefern", "to deliver", "Eine Ware zum Kunden bringen.", "Wir liefern innerhalb von zwei Tagen."),

  // --- 44. Was gemacht werden muss ---
  n("die Vorschrift", "Vorschriften", "regulation", "Eine Regel, an die man sich halten muss.", "Die Vorschrift gilt für alle Betriebe."),
  n("die Genehmigung", "Genehmigungen", "permit", "Die offizielle Erlaubnis für etwas.", "Ohne Genehmigung darf hier nicht gebaut werden."),
  v("beantragen", "to apply for", "Etwas offiziell schriftlich verlangen.", "Den Zuschuss muss man vorher beantragen."),
  adj("verpflichtet", "obliged", "Dazu gebracht, etwas tun zu müssen.", "Vermieter sind zur Reparatur verpflichtet."),
  n("die Frist", "Fristen", "deadline", "Der Zeitraum, in dem etwas erledigt sein muss.", "Die Frist läuft am Monatsende ab."),
  v("einhalten", "to keep to", "Sich an etwas Vereinbartes halten.", "Wir konnten den Termin nicht einhalten."),

  // --- 45. Was andere sagen ---
  n("die Aussage", "Aussagen", "statement", "Das, was jemand über eine Sache gesagt hat.", "Seine Aussage widerspricht dem Bericht."),
  adv("angeblich", "allegedly", "Wie behauptet wird, aber ohne Beweis.", "Er war angeblich gar nicht dort."),
  w("laut", "preposition", "according to", "Nennt die Quelle einer Information.", "Laut Zeitung wird der Bahnhof umgebaut."),
  v("zitieren", "to quote", "Die Worte eines anderen wörtlich wiedergeben.", "Sie zitierte einen Satz aus dem Vertrag."),
  v("bestreiten", "to deny", "Behaupten, dass etwas nicht stimmt.", "Der Betrieb bestreitet jede Schuld."),
  n("die Quelle", "Quellen", "source", "Der Ursprung einer Information.", "Nenn bitte deine Quelle."),

  // --- 46. Arbeitswelt ---
  n("der Vertrag", "Verträge", "contract", "Die schriftliche Vereinbarung zwischen zwei Seiten.", "Der Vertrag läuft über zwei Jahre."),
  n("die Kündigung", "Kündigungen", "notice, termination", "Die Erklärung, ein Verhältnis zu beenden.", "Die Kündigung muss schriftlich erfolgen."),
  adj("befristet", "fixed-term", "Nur für eine bestimmte Zeit gültig.", "Die Stelle ist auf ein Jahr befristet."),
  n("die Beförderung", "Beförderungen", "promotion", "Der Aufstieg in eine höhere Position.", "Nach der Beförderung leitet sie das Team."),
  n("das Betriebsklima", null, "working atmosphere", "Die Stimmung unter den Beschäftigten.", "Das Betriebsklima ist hier erstaunlich gut."),
  n("die Überstunde", "Überstunden", "overtime hour", "Eine Arbeitsstunde über die vereinbarte Zeit hinaus.", "Die Überstunden werden nicht bezahlt."),

  // --- 47. Das Vorstellungsgespräch ---
  n("die Stärke", "Stärken", "strength", "Etwas, das jemand besonders gut kann.", "Meine größte Stärke ist die Organisation."),
  n("die Schwäche", "Schwächen", "weakness", "Etwas, das jemand weniger gut kann.", "Ungeduld ist meine größte Schwäche."),
  n("der Werdegang", "Werdegänge", "career path", "Der Weg durch Ausbildung und Beruf.", "Erzählen Sie kurz von Ihrem Werdegang."),
  v("sich einarbeiten", "to get up to speed", "Sich in eine neue Aufgabe hineinfinden.", "Ich arbeite mich schnell in neue Themen ein."),
  n("die Herausforderung", "Herausforderungen", "challenge", "Eine schwierige Aufgabe, die reizt.", "Die Stelle ist genau die Herausforderung, die ich suche."),
  adj("motiviert", "motivated", "Mit dem inneren Antrieb, etwas zu tun.", "Das Team wirkt sehr motiviert."),

  // --- 48. Studium und Weiterbildung ---
  n("der Studiengang", "Studiengänge", "degree programme", "Das Fach, das man an einer Hochschule studiert.", "Der Studiengang dauert sechs Semester."),
  v("sich einschreiben", "to enrol", "Sich offiziell an einer Hochschule anmelden.", "Ich habe mich für Informatik eingeschrieben."),
  n("die Prüfung", "Prüfungen", "exam", "Ein Test, der über den Abschluss entscheidet.", "Die Prüfung ist Anfang März."),
  n("der Abschluss", "Abschlüsse", "degree, qualification", "Der Nachweis über ein beendetes Studium.", "Ohne Abschluss ist es schwieriger."),
  n("die Fortbildung", "Fortbildungen", "further training", "Ein Kurs, der berufliche Kenntnisse erweitert.", "Die Firma zahlt die Fortbildung."),
  n("das Stipendium", "Stipendien", "scholarship", "Geld, das ein Studium finanziert.", "Sie hat ein Stipendium bekommen."),

  // --- 49. Wohnen in Deutschland ---
  n("der Mietvertrag", "Mietverträge", "tenancy agreement", "Der Vertrag zwischen Mieter und Vermieter.", "Steht das wirklich so im Mietvertrag?"),
  n("die Nebenkosten", null, "service charges", "Die Kosten neben der reinen Miete.", "Die Nebenkosten sind noch nicht enthalten."),
  n("die Hausordnung", "Hausordnungen", "house rules", "Die Regeln für alle Bewohner eines Hauses.", "Die Hausordnung verbietet Lärm nach zweiundzwanzig Uhr."),
  v("kündigen", "to give notice", "Einen Vertrag offiziell beenden.", "Wir haben zum Ende des Quartals gekündigt."),
  n("der Mangel", "Mängel", "defect", "Ein Fehler, der beseitigt werden muss.", "Den Mangel sollten Sie schriftlich melden."),
  n("die Nachzahlung", "Nachzahlungen", "back payment", "Geld, das man nachträglich zahlen muss.", "Die Nachzahlung war höher als erwartet."),

  // --- 50. Behörden ---
  n("das Amt", "Ämter", "public office", "Eine Behörde mit einer bestimmten Zuständigkeit.", "Das Amt hat nur vormittags geöffnet."),
  n("die Anmeldung", "Anmeldungen", "registration", "Die offizielle Meldung an einer Stelle.", "Die Anmeldung muss binnen zwei Wochen erfolgen."),
  n("das Formular", "Formulare", "form", "Ein Blatt mit Feldern zum Ausfüllen.", "Das Formular gibt es auch online."),
  n("die Bescheinigung", "Bescheinigungen", "certificate", "Ein Papier, das etwas offiziell bestätigt.", "Ich brauche eine Bescheinigung vom Arbeitgeber."),
  adj("zuständig", "responsible", "Für eine Sache verantwortlich.", "Dafür ist eine andere Stelle zuständig."),
  n("der Antrag", "Anträge", "application", "Die schriftliche Bitte an eine Behörde.", "Der Antrag wurde ohne Begründung abgelehnt."),

  // --- 51. Geld und Verträge ---
  n("die Versicherung", "Versicherungen", "insurance", "Ein Vertrag, der bei Schäden zahlt.", "Die Versicherung kommt für den Schaden auf."),
  n("die Rate", "Raten", "instalment", "Ein Teilbetrag, den man regelmäßig zahlt.", "Wir zahlen das Gerät in zwölf Raten."),
  n("die Gebühr", "Gebühren", "fee", "Das Geld für eine Dienstleistung.", "Für die Überweisung fällt keine Gebühr an."),
  v("abschließen", "to take out, to conclude", "Einen Vertrag gültig machen.", "Ich habe die Versicherung online abgeschlossen."),
  n("der Schaden", "Schäden", "damage", "Ein Verlust oder eine Beschädigung.", "Den Schaden zahlt die Versicherung."),
  n("die Laufzeit", "Laufzeiten", "term", "Die Zeit, für die ein Vertrag gilt.", "Die Laufzeit beträgt vierundzwanzig Monate."),

  // --- 52. Das Gesundheitssystem ---
  n("die Krankenkasse", "Krankenkassen", "health insurer", "Die Stelle, die Behandlungskosten übernimmt.", "Meine Krankenkasse zahlt die Brille nicht."),
  n("die Überweisung", "Überweisungen", "referral", "Das Papier, mit dem man zum Facharzt geht.", "Für den Termin brauchen Sie eine Überweisung."),
  n("die Behandlung", "Behandlungen", "treatment", "Alles, was ein Arzt gegen eine Krankheit tut.", "Die Behandlung zieht sich über Wochen."),
  n("der Facharzt", "Fachärzte", "specialist", "Ein Arzt für ein bestimmtes Gebiet.", "Beim Facharzt wartet man oft monatelang."),
  n("die Zuzahlung", "Zuzahlungen", "co-payment", "Der Anteil, den der Patient selbst zahlt.", "Die Zuzahlung beträgt zehn Euro."),
  v("sich versichern", "to take out insurance", "Sich gegen ein Risiko absichern.", "Man muss sich in Deutschland krankenversichern."),

  // --- 53. Nachhaltigkeit ---
  adj("nachhaltig", "sustainable", "So, dass künftige Generationen nicht belastet werden.", "Nachhaltig heißt nicht automatisch teuer."),
  n("der Verbrauch", null, "consumption", "Die Menge, die benutzt oder aufgebraucht wird.", "Der Verbrauch ist um ein Fünftel gesunken."),
  n("die Auswirkung", "Auswirkungen", "effect", "Die Folge, die etwas an anderer Stelle hat.", "Die Auswirkungen zeigen sich erst später."),
  v("verzichten", "to do without", "Etwas bewusst nicht nehmen oder tun.", "Auf das Auto möchte ich nicht verzichten."),
  n("der Klimawandel", null, "climate change", "Die langfristige Veränderung des Klimas.", "Der Klimawandel trifft die Landwirtschaft zuerst."),
  v("fördern", "to promote, to support", "Etwas gezielt unterstützen.", "Die Stadt fördert den Radverkehr."),

  // --- 54. Mobilität ---
  n("der Nahverkehr", null, "local transport", "Busse und Bahnen im nahen Umkreis.", "Der Nahverkehr ist hier gut ausgebaut."),
  n("die Anbindung", "Anbindungen", "transport links", "Die Verbindung eines Orts an das Verkehrsnetz.", "Die Anbindung ans Zentrum ist schlecht."),
  n("der Stau", "Staus", "traffic jam", "Fahrzeuge, die dicht hintereinander stehen.", "Wir standen zwei Stunden im Stau."),
  v("ausbauen", "to expand", "Etwas größer oder leistungsfähiger machen.", "Die Strecke soll bis zweitausenddreißig ausgebaut werden."),
  n("das Fahrverbot", "Fahrverbote", "driving ban", "Das Verbot, mit bestimmten Fahrzeugen zu fahren.", "In der Innenstadt gilt ein Fahrverbot."),
  v("pendeln", "to commute", "Regelmäßig zwischen Wohnort und Arbeit fahren.", "Sie pendelt täglich nach Frankfurt."),

  // --- 55. Digital und Datenschutz ---
  n("die Daten", null, "data", "Gespeicherte Angaben über Personen oder Dinge.", "Meine Daten sollen dort nicht landen."),
  v("speichern", "to store", "Etwas dauerhaft festhalten.", "Die App speichert den Standort dauerhaft."),
  n("der Zugriff", "Zugriffe", "access", "Die Möglichkeit, an etwas heranzukommen.", "Wer hat Zugriff auf diese Datei?"),
  n("die Einwilligung", "Einwilligungen", "consent", "Die ausdrückliche Erlaubnis einer Person.", "Ohne Einwilligung ist das nicht zulässig."),
  v("verschlüsseln", "to encrypt", "Daten für Unbefugte unlesbar machen.", "Die Nachrichten werden Ende zu Ende verschlüsselt."),
  v("missbrauchen", "to misuse", "Etwas auf schädliche Weise benutzen.", "Die Daten wurden für Werbung missbraucht."),

  // --- 56. Nachrichten lesen ---
  n("die Schlagzeile", "Schlagzeilen", "headline", "Die große Überschrift über einem Artikel.", "Die Schlagzeile verspricht mehr als der Text hält."),
  adj("glaubwürdig", "credible", "So, dass man es glauben kann.", "Die Quelle wirkt nicht besonders glaubwürdig."),
  n("die Recherche", "Recherchen", "research", "Das gründliche Suchen nach Informationen.", "Die Recherche hat Monate gedauert."),
  n("der Bericht", "Berichte", "report", "Ein sachlicher Text über ein Ereignis.", "Der Bericht nennt keine Namen."),
  v("verbreiten", "to spread", "Etwas an viele Menschen weitergeben.", "Das Gerücht verbreitete sich in Stunden."),
  n("die Meldung", "Meldungen", "news item", "Eine kurze Nachricht über ein Ereignis.", "Die Meldung wurde später zurückgezogen."),

  // --- 57. Kunst und Literatur ---
  n("der Roman", "Romane", "novel", "Ein langes erzählendes Buch.", "Den Roman habe ich in drei Tagen gelesen."),
  n("die Handlung", "Handlungen", "plot", "Das, was in einer Geschichte passiert.", "Die Handlung kommt erst spät in Gang."),
  n("die Figur", "Figuren", "character", "Eine erfundene Person in einer Geschichte.", "Die Figur der Mutter bleibt blass."),
  n("das Werk", "Werke", "work", "Ein einzelnes Erzeugnis der Kunst.", "Das Werk entstand kurz vor seinem Tod."),
  adj("beeindruckend", "impressive", "So, dass es starken Eindruck macht.", "Die Ausstellung war wirklich beeindruckend."),
  v("deuten", "to interpret", "Einen Sinn in etwas hineinlesen.", "Das Ende lässt sich unterschiedlich deuten."),

  // --- 58. Film und Musik ---
  n("die Regie", null, "direction", "Die künstlerische Leitung eines Films.", "Die Regie führte eine junge Österreicherin."),
  n("die Szene", "Szenen", "scene", "Ein zusammenhängender Abschnitt eines Films.", "Die letzte Szene bleibt lange im Kopf."),
  n("der Soundtrack", "Soundtracks", "soundtrack", "Die Musik zu einem Film.", "Der Soundtrack ist besser als der Film."),
  adj("gelungen", "successful, well done", "So, dass es gut geworden ist.", "Eine sehr gelungene Verfilmung."),
  n("der Geschmack", "Geschmäcker", "taste", "Das, was jemandem gefällt.", "Über Geschmack lässt sich streiten."),
  n("die Kritik", "Kritiken", "review, criticism", "Die Beurteilung eines Werks oder einer Sache.", "Die Kritik in der Zeitung war vernichtend."),

  // --- 59. Geschichte und Erinnerung ---
  n("die Vergangenheit", null, "the past", "Die Zeit, die schon vorbei ist.", "Man kann die Vergangenheit nicht ändern."),
  n("die Erinnerung", "Erinnerungen", "memory", "Das Bild, das vom Erlebten im Kopf bleibt.", "An den Tag habe ich kaum Erinnerungen."),
  n("das Denkmal", "Denkmäler", "monument", "Ein Bauwerk zum Gedenken an etwas.", "Das Denkmal steht mitten auf dem Platz."),
  n("die Wende", "Wenden", "turning point", "Ein grundlegender Wechsel, in Deutschland der von neunzehnhundertneunundachtzig.", "Nach der Wende zogen viele in den Westen."),
  n("die Mauer", "Mauern", "wall", "Eine feste Wand aus Stein, in Berlin die Grenze bis neunzehnhundertneunundachtzig.", "Die Mauer fiel im November."),
  v("gedenken", "to commemorate", "Sich öffentlich an jemanden erinnern.", "Die Stadt gedenkt der Opfer jedes Jahr."),

  // --- 60. Ankommen und Dazugehören ---
  n("die Herkunft", null, "origin", "Der Ort und die Familie, aus denen jemand stammt.", "Nach meiner Herkunft werde ich täglich gefragt."),
  v("sich integrieren", "to integrate", "Ein Teil einer Gemeinschaft werden.", "Sie hat sich schnell integriert."),
  n("die Heimat", null, "home, homeland", "Der Ort, an dem sich jemand zu Hause fühlt.", "Heimat ist für mich kein Ort, sondern ein Gefühl."),
  n("das Vorurteil", "Vorurteile", "prejudice", "Ein festes Urteil ohne eigene Erfahrung.", "Gegen dieses Vorurteil komme ich nicht an."),
  v("sich zurechtfinden", "to find one's way", "In einer neuen Lage klarkommen.", "Am Anfang habe ich mich kaum zurechtgefunden."),
  n("die Erwartung", "Erwartungen", "expectation", "Das, womit jemand fest rechnet.", "Die Stadt hat meine Erwartungen übertroffen."),

  // --- 61. Zusammenleben ---
  n("die Rücksicht", null, "consideration", "Das Achten auf die Bedürfnisse anderer.", "Ein bisschen Rücksicht wäre schön."),
  n("die Regel", "Regeln", "rule", "Eine Vorgabe, an die sich alle halten.", "Diese Regel steht nirgends geschrieben."),
  n("das Ehrenamt", "Ehrenämter", "voluntary work", "Eine Tätigkeit ohne Bezahlung für die Allgemeinheit.", "Ihr Ehrenamt kostet sie zwei Abende pro Woche."),
  n("die Gemeinschaft", "Gemeinschaften", "community", "Eine Gruppe, die etwas verbindet.", "Im Dorf ist die Gemeinschaft noch stark."),
  v("sich engagieren", "to get involved", "Sich aktiv für etwas einsetzen.", "Er engagiert sich in der Nachbarschaftshilfe."),
  n("der Konflikt", "Konflikte", "conflict", "Ein Streit zwischen unvereinbaren Interessen.", "Der Konflikt schwelt seit Jahren."),

  // --- 62. Wissenschaft und Technik ---
  n("die Forschung", "Forschungen", "research", "Die systematische Suche nach neuem Wissen.", "Die Forschung steckt noch am Anfang."),
  n("die Entwicklung", "Entwicklungen", "development", "Die Veränderung über einen längeren Zeitraum.", "Die Entwicklung ging schneller als erwartet."),
  n("der Versuch", "Versuche", "experiment, attempt", "Ein Test, mit dem man etwas herausfinden will.", "Der Versuch wurde mehrfach wiederholt."),
  n("das Ergebnis", "Ergebnisse", "result", "Das, was am Ende herauskommt.", "Das Ergebnis überraschte selbst die Forscher."),
  n("der Fortschritt", "Fortschritte", "progress", "Ein Schritt nach vorn gegenüber vorher.", "In der Medizin gibt es echte Fortschritte."),
  v("beweisen", "to prove", "Sicher zeigen, dass etwas stimmt.", "Das lässt sich bisher nicht beweisen."),

  // --- 63. Konsum und Werbung ---
  n("die Werbung", "Werbungen", "advertising", "Alles, was zum Kaufen anregen soll.", "Die Werbung läuft in jeder Pause."),
  n("die Marke", "Marken", "brand", "Der geschützte Name eines Herstellers.", "Für die Marke zahlt man das Doppelte."),
  n("der Rabatt", "Rabatte", "discount", "Der Nachlass auf den normalen Preis.", "Ab drei Stück gibt es zehn Prozent Rabatt."),
  v("verlocken", "to tempt", "Jemanden mit einem Reiz anziehen.", "Das Angebot verlockt, aber ich brauche es nicht."),
  n("der Konsum", null, "consumption", "Das Kaufen und Verbrauchen von Waren.", "Unser Konsum hat Folgen für andere."),
  v("sich leisten", "to afford", "Genug Geld für etwas haben.", "Diese Miete kann ich mir nicht leisten."),

  // --- 64. Unterwegs in der Welt ---
  n("die Sitte", "Sitten", "custom", "Ein üblicher Umgang in einer Gesellschaft.", "Diese Sitte kannte ich vorher nicht."),
  n("der Unterschied", "Unterschiede", "difference", "Das, worin zwei Dinge nicht übereinstimmen.", "Der größte Unterschied ist die Begrüßung."),
  v("sich anpassen", "to adapt", "Sich neuen Umständen angleichen.", "Man passt sich schneller an, als man denkt."),
  n("das Missverständnis", "Missverständnisse", "misunderstanding", "Eine Aussage, die falsch aufgefasst wurde.", "Das war ein reines Missverständnis."),
  adj("gastfreundlich", "hospitable", "Gäste offen und großzügig aufnehmend.", "Die Nachbarn waren ausgesprochen gastfreundlich."),
  adj("fremd", "foreign, unfamiliar", "Nicht vertraut oder nicht von hier.", "Am Anfang war mir alles fremd."),

  // --- 65. Feste und Regionen ---
  n("der Brauch", "Bräuche", "custom, tradition", "Eine alte Gewohnheit, die weitergegeben wird.", "Dieser Brauch stammt aus dem Mittelalter."),
  n("die Region", "Regionen", "region", "Ein Gebiet mit eigenen Merkmalen.", "Jede Region hat ihr eigenes Brot."),
  n("der Dialekt", "Dialekte", "dialect", "Die örtliche Form einer Sprache.", "Den Dialekt verstehe ich kaum."),
  n("die Tracht", "Trachten", "traditional dress", "Die überlieferte Kleidung einer Gegend.", "Zum Fest tragen viele die Tracht."),
  v("stattfinden", "to take place", "Zu einer Zeit an einem Ort geschehen.", "Das Fest findet jedes Jahr im Juni statt."),
  v("überliefern", "to pass down", "Von einer Generation zur nächsten weitergeben.", "Die Geschichte wurde mündlich überliefert."),

  // --- 66. Gefühle und Konflikte ---
  n("die Wut", null, "anger", "Ein starkes Gefühl des Zorns.", "Vor Wut konnte ich nichts mehr sagen."),
  v("sich beruhigen", "to calm down", "Wieder ruhig werden.", "Beruhig dich erst einmal."),
  v("verletzen", "to hurt", "Jemandem körperlich oder seelisch schaden.", "Diese Bemerkung hat sie verletzt."),
  n("der Vorwurf", "Vorwürfe", "accusation, reproach", "Die Behauptung, jemand habe falsch gehandelt.", "Der Vorwurf trifft mich zu Unrecht."),
  v("nachgeben", "to give in", "Den eigenen Standpunkt aufgeben.", "Irgendwann muss einer nachgeben."),
  n("die Enttäuschung", "Enttäuschungen", "disappointment", "Das Gefühl, wenn eine Hoffnung platzt.", "Die Absage war eine große Enttäuschung."),

  // --- 67. Verhandeln ---
  n("der Kompromiss", "Kompromisse", "compromise", "Eine Lösung, bei der beide Seiten nachgeben.", "Am Ende fanden wir einen Kompromiss."),
  n("die Bedingung", "Bedingungen", "condition", "Das, was erfüllt sein muss.", "Unter einer Bedingung mache ich mit."),
  v("verhandeln", "to negotiate", "Über eine Einigung sprechen.", "Über den Preis lässt sich verhandeln."),
  n("das Angebot", "Angebote", "offer", "Der Vorschlag, etwas zu bestimmten Konditionen zu geben.", "Ihr Angebot liegt deutlich zu niedrig."),
  v("ablehnen", "to reject", "Etwas nicht annehmen.", "Wir mussten das Angebot ablehnen."),
  v("sich einigen", "to reach agreement", "Nach Verhandlung zu einer gemeinsamen Lösung kommen.", "Wir haben uns auf Mittwoch geeinigt."),

  // --- 68. Argumentieren ---
  n("die These", "Thesen", "thesis, proposition", "Die Behauptung, um die es in einem Text geht.", "Die These überzeugt mich noch nicht."),
  n("das Beispiel", "Beispiele", "example", "Ein einzelner Fall, der etwas veranschaulicht.", "Nenn mir bitte ein konkretes Beispiel."),
  n("der Beleg", "Belege", "piece of evidence", "Etwas, das eine Behauptung stützt.", "Für diese Zahl fehlt jeder Beleg."),
  v("zusammenfassen", "to summarise", "Das Wichtigste kurz wiedergeben.", "Fassen Sie das bitte in zwei Sätzen zusammen."),
  v("gliedern", "to structure", "Etwas in klare Abschnitte teilen.", "Der Vortrag ist gut gegliedert."),
  v("überzeugen", "to convince", "Jemanden dazu bringen, etwas zu glauben.", "Das Argument hat mich überzeugt."),

  // --- 69. Pläne und Prognosen ---
  n("die Prognose", "Prognosen", "forecast", "Die Vorhersage einer künftigen Entwicklung.", "Die Prognose wurde nach unten korrigiert."),
  adv("voraussichtlich", "probably, expected to", "Nach dem, was sich absehen lässt.", "Der Umbau dauert voraussichtlich ein Jahr."),
  n("die Absicht", "Absichten", "intention", "Das, was jemand vorhat.", "Meine Absicht war eine ganz andere."),
  v("sich entwickeln", "to develop", "Sich über die Zeit verändern.", "Der Markt entwickelt sich langsamer als gedacht."),
  adj("langfristig", "long-term", "Über einen langen Zeitraum wirkend.", "Langfristig lohnt sich die Investition."),
  phrase("rechnen mit", "to count on, to expect", "Etwas als wahrscheinlich einplanen.", "Wir rechnen mit einer Antwort bis Freitag."),

  // --- 70. Frei sprechen ---
  adj("spontan", "spontaneous", "Ohne Vorbereitung, aus dem Moment heraus.", "Sie antwortet gern spontan."),
  n("der Faden", "Fäden", "thread", "Der rote Faden ist der Zusammenhang einer Rede.", "Mitten im Satz habe ich den Faden verloren."),
  v("ausweichen", "to dodge, to evade", "Einer Sache aus dem Weg gehen.", "Er ist der Frage geschickt ausgewichen."),
  v("umschreiben", "to paraphrase", "Etwas mit anderen Worten sagen.", "Wenn dir ein Wort fehlt, umschreib es einfach."),
  n("die Redewendung", "Redewendungen", "idiom", "Eine feste Wortverbindung mit übertragener Bedeutung.", "Diese Redewendung benutzt heute kaum jemand."),
  v("sich trauen", "to dare", "Den Mut haben, etwas zu tun.", "Trau dich, einfach anzufangen!"),
];
