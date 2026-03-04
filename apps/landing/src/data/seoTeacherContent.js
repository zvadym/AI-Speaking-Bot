import { normalizeLocale } from '../i18n.js';
import { normalizeLanguageCodeForSlugs } from './slugTokens.js';
import { getTeacherName } from './teachers.js';

const LANGUAGE_FORMS = {
  en: {
    en: { display: 'English', adjective: 'English' },
    de: { display: 'German', adjective: 'German' },
    es: { display: 'Spanish', adjective: 'Spanish' },
    it: { display: 'Italian', adjective: 'Italian' },
    pl: { display: 'Polish', adjective: 'Polish' },
    pt: { display: 'Portuguese', adjective: 'Portuguese' },
    uk: { display: 'Ukrainian', adjective: 'Ukrainian' }
  },
  de: {
    en: { display: 'Englisch' },
    de: { display: 'Deutsch' },
    es: { display: 'Spanisch' },
    it: { display: 'Italienisch' },
    pl: { display: 'Polnisch' },
    pt: { display: 'Portugiesisch' },
    uk: { display: 'Ukrainisch' }
  },
  uk: {
    en: {
      display: 'англійська',
      genitive: 'англійської',
      accusative: 'англійську',
      instrumental: 'англійською'
    },
    de: {
      display: 'німецька',
      genitive: 'німецької',
      accusative: 'німецьку',
      instrumental: 'німецькою'
    },
    es: {
      display: 'іспанська',
      genitive: 'іспанської',
      accusative: 'іспанську',
      instrumental: 'іспанською'
    },
    it: {
      display: 'італійська',
      genitive: 'італійської',
      accusative: 'італійську',
      instrumental: 'італійською'
    },
    pl: {
      display: 'польська',
      genitive: 'польської',
      accusative: 'польську',
      instrumental: 'польською'
    },
    pt: {
      display: 'португальська',
      genitive: 'португальської',
      accusative: 'португальську',
      instrumental: 'португальською'
    },
    uk: {
      display: 'українська',
      genitive: 'української',
      accusative: 'українську',
      instrumental: 'українською'
    }
  },
  it: {
    en: { display: 'inglese' },
    de: { display: 'tedesco' },
    es: { display: 'spagnolo' },
    it: { display: 'italiano' },
    pl: { display: 'polacco' },
    pt: { display: 'portoghese' },
    uk: { display: 'ucraino' }
  },
  es: {
    en: { display: 'inglés' },
    de: { display: 'alemán' },
    es: { display: 'español' },
    it: { display: 'italiano' },
    pl: { display: 'polaco' },
    pt: { display: 'portugués' },
    uk: { display: 'ucraniano' }
  },
  pt: {
    en: { display: 'inglês' },
    de: { display: 'alemão' },
    es: { display: 'espanhol' },
    it: { display: 'italiano' },
    pl: { display: 'polonês' },
    pt: { display: 'português' },
    uk: { display: 'ucraniano' }
  },
  tr: {
    en: { display: 'İngilizce' },
    de: { display: 'Almanca' },
    es: { display: 'İspanyolca' },
    it: { display: 'İtalyanca' },
    pl: { display: 'Lehçe' },
    pt: { display: 'Portekizce' },
    uk: { display: 'Ukraynaca' }
  }
};

function fallbackLanguageForm(locale, code) {
  const normalizedCode = normalizeLanguageCodeForSlugs(code) || 'en';
  const map = LANGUAGE_FORMS[locale] || LANGUAGE_FORMS.en;
  if (map[normalizedCode]) return map[normalizedCode];
  return { display: normalizedCode.toUpperCase(), adjective: normalizedCode.toUpperCase(), genitive: normalizedCode.toUpperCase() };
}

function getLanguageForm(localeInput, languageCodeInput) {
  const locale = normalizeLocale(localeInput) || 'en';
  const code = normalizeLanguageCodeForSlugs(languageCodeInput) || 'en';
  return fallbackLanguageForm(locale, code);
}

function buildEnglishContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'en') || 'Teacher';
  const targetLanguage = languageForm.display || languageForm.adjective || 'English';

  return {
    metaTitle: `${targetLanguage} speaking practice in Telegram with ${teacherName} | AI Language School`,
    metaDescription: `Practice spoken ${targetLanguage} in Telegram with instant corrections, natural phrasing, and daily micro-lessons. Learn with ${teacherName} and start in one minute.`,
    h1: `${targetLanguage} speaking practice on Telegram with ${teacherName}`,
    heroLead: `Practice real ${targetLanguage} conversations directly in Telegram. Send a short voice message, and ${teacherName} replies with a corrected, more natural version you can reuse right away.`,
    heroOutcome: `Build practical fluency for work, interviews, travel, and daily life with faster responses, clearer pronunciation, and less hesitation.`,
    coreBullets: [
      'Instant correction with clear alternatives you can reuse in the next message.',
      'Pronunciation, fluency, and natural phrasing support in a daily chat format.',
      'Micro-practice that fits your schedule: consistent progress in 10–15 minutes.'
    ],
    howTitle: 'How it works',
    howSteps: [
      {
        title: '1. Send a real voice message',
        description: `Record one short message about your day, plans, or a real-life problem. You do not need to prepare scripts — use your current level and speak naturally.`
      },
      {
        title: '2. Get instant correction and a stronger version',
        description: `You receive a corrected version, a more natural alternative, and a clear explanation of the key rule. The correction is practical and easy to apply immediately.`
      },
      {
        title: '3. Continue the dialogue and build habit',
        description: `Each response ends with a follow-up question, so you keep speaking instead of stopping after one sentence. This creates daily speaking momentum and measurable fluency growth.`
      }
    ],
    forWhoTitle: 'Who this is for',
    forWhoIntro: `${teacherName} is designed for learners who need practical speaking outcomes, not passive grammar reading.`,
    forWhoItems: [
      {
        title: 'Work communication',
        description: `Prepare for meetings, status updates, and short professional calls. Practice saying the same idea in direct, polite, and natural ways.`
      },
      {
        title: 'Interview preparation',
        description: `Train common interview themes: introduction, strengths, project stories, and salary expectations. Build short answers first, then expand them naturally.`
      },
      {
        title: 'Relocation and daily life',
        description: `Practice language for documents, appointments, renting an apartment, transportation, and daily service conversations where clarity matters.`
      },
      {
        title: 'Travel conversations',
        description: `Learn high-frequency phrases for airports, hotels, restaurants, and emergency situations so you can react quickly under pressure.`
      }
    ],
    dialoguesTitle: 'Dialogue example',
    dialoguesIntro: `A short real-life chat sample. See how a voice message turns into a clearer reply, a rule-based explanation, and next-message options.`,
    deepDiveTitle: `Build real ${targetLanguage} fluency with daily Telegram practice`,
    deepDiveParagraphs: [
      `Most learners do not struggle because they “lack vocabulary.” They struggle because they cannot retrieve the right phrase fast enough in real moments. This page solves that by training response speed, sentence structure, and conversational rhythm in one workflow. You practice exactly where conversation pressure appears: short, unscripted replies in chat.`,
      `The method is simple: one short voice message, one correction loop, one follow-up question, repeated daily. Instead of consuming long lessons once a week, you build a speaking habit that compounds. The result is not only better grammar. You sound clearer, faster, and more natural in everyday interactions, even when you are tired or in a hurry.`,
      `Correction quality matters. Generic feedback like “sounds better this way” is not enough. You receive concrete alternatives and rule-level explanations, so you understand what changed and why it changed. Over time, this trains your internal pattern recognition: you start noticing common errors before they leave your mouth.`,
      `Telegram format is intentional. You already use it every day, so friction is low. No scheduling calls, no extra apps, no awkward setup. This makes consistency realistic for busy people with work, family, and travel. Small daily repetitions beat occasional perfect sessions, especially for speaking confidence.`,
      `You can start from short answers and expand safely. If you are an A1–A2 learner, keep messages very short and focus on one correction at a time. If you are B1–C1, train richer answers, argument structure, and collocations for work and interviews. The same system scales with your level because feedback stays contextual and practical.`,
      `With ${teacherName}, your progress path is clear: speak, get corrected, reuse better phrases, and repeat. After a few weeks, learners usually notice three outcomes: less hesitation, cleaner sentence flow, and better reactions in live situations. That is the core objective of AI Language School: practical spoken fluency you can use immediately.`
    ],
    faqTitle: 'FAQ',
    faqItems: [
      {
        question: `Is this really ${targetLanguage} speaking practice, or mostly grammar?`,
        answer: 'It is speaking-first. Grammar appears only as practical correction inside real dialogue, not as isolated theory blocks.'
      },
      {
        question: 'How much time should I practice each day?',
        answer: 'Start with 10–15 minutes daily. Consistency matters more than long sessions once in a while.'
      },
      {
        question: 'Do I need to schedule lessons?',
        answer: 'No. You practice asynchronously in Telegram whenever you have a free moment.'
      },
      {
        question: 'Can beginners use this format?',
        answer: 'Yes. Beginners can send very short messages and receive simple, high-impact corrections.'
      },
      {
        question: 'Will I get pronunciation support?',
        answer: 'Yes. Feedback includes fluency and pronunciation guidance, not only text correction.'
      },
      {
        question: 'Is this useful for interviews?',
        answer: 'Yes. You can train structured interview answers and follow-up questions repeatedly until they feel natural.'
      },
      {
        question: 'Can I practice relocation scenarios?',
        answer: 'Yes. Common scenarios include renting, doctor visits, paperwork, and service conversations.'
      },
      {
        question: 'How is this different from random chatbots?',
        answer: 'This workflow is correction-driven and outcome-oriented: each response improves your next spoken attempt.'
      },
      {
        question: 'Can I switch teacher style later?',
        answer: 'Yes. You can open the teachers list and choose a different teacher style anytime.'
      },
      {
        question: 'What is the fastest way to see progress?',
        answer: 'Speak daily, reuse corrected phrases, and answer each follow-up question in full sentences.'
      }
    ],
    otherTeachersTitle: 'Choose another teacher'
  };
}

function buildUkrainianContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'uk') || getTeacherName(teacher, 'en') || 'викладач';
  const targetDisplay = languageForm.display || 'англійська';
  const targetGenitive = languageForm.genitive || targetDisplay;
  const targetAccusative = languageForm.accusative || targetDisplay;
  const targetInstrumental = languageForm.instrumental || targetDisplay;

  return {
    metaTitle: `Практика розмовної ${targetGenitive} в Telegram з ${teacherName} — AI викладач | AI Language School`,
    metaDescription: `Практикуй розмовну ${targetAccusative} щодня: надсилай голосові в Telegram, отримуй миттєві виправлення, природні фрази та чіткий фідбек. Почни за 1 хвилину з ${teacherName}.`,
    h1: `Практика розмовної ${targetGenitive} у Telegram з ${teacherName}`,
    heroLead: `Практикуй живе спілкування ${targetInstrumental} у Telegram. Надішли коротке голосове, і ${teacherName} поверне виправлену та природнішу версію, яку можна одразу повторити.`,
    heroOutcome: `Ти швидше формулюєш думки, говориш чіткіше й упевненіше в роботі, на співбесідах, у подорожах та щоденних ситуаціях.`,
    coreBullets: [
      'Миттєві виправлення: помилки, кращі фрази, чітка логіка, чому саме так.',
      'Фокус на вимові, плавності та природному формулюванні думки в діалозі.',
      'Щоденна мікропрактика в Telegram, яку реально підтримувати навіть у щільному графіку.'
    ],
    howTitle: 'Як це працює',
    howSteps: [
      {
        title: '1. Надішли коротке голосове',
        description: 'Говори своїми словами про реальну ситуацію: день, задачу, плани або проблему. Не готуй ідеальний текст — важлива жива мова.'
      },
      {
        title: '2. Отримай виправлення і кращу версію',
        description: `Ти бачиш, як сказати ту саму думку точніше, природніше і зрозуміліше. ${teacherName} дає конкретні альтернативи, які можна одразу повторити.`
      },
      {
        title: '3. Продовж діалог і закріпи навичку',
        description: 'Кожна відповідь завершується питанням, щоб ти говорив далі. Так формується щоденна звичка говорити, а не просто читати правила.'
      }
    ],
    forWhoTitle: 'Для кого',
    forWhoIntro: `AI репетитор ${targetGenitive} у Telegram підходить, якщо тобі потрібна практична розмовна мова для конкретних життєвих задач.`,
    forWhoItems: [
      {
        title: 'Робота і щоденні робочі діалоги',
        description: 'Тренуй апдейти, уточнення, короткі дзвінки, фолоу-апи та аргументацію. Вчись звучати професійно без надмірної складності.'
      },
      {
        title: 'Співбесіда',
        description: 'Прокачуй відповіді про досвід, сильні сторони, кейси, очікування та мотивацію. Відпрацьовуй структуру і швидкість реакції.'
      },
      {
        title: 'Переїзд і документи',
        description: 'Відпрацьовуй ситуації оренди, банку, медицини, державних сервісів та побутових звернень, де важливі точність і ясність.'
      },
      {
        title: 'Подорожі і щоденне спілкування',
        description: 'Підготуй фрази для аеропорту, готелю, транспорту, ресторанів і несподіваних ситуацій, щоб спокійно реагувати на місці.'
      }
    ],
    dialoguesTitle: 'Приклад діалогу',
    dialoguesIntro: 'Короткий приклад реального діалогу. Голосове → краща відповідь → пояснення правила → варіанти для наступної репліки.',
    deepDiveTitle: `Як реально прокачати розмовну ${targetAccusative} через Telegram`,
    deepDiveParagraphs: [
      `Більшість людей застрягають не через “мало слів”, а через повільне формулювання думки в реальному діалозі. Ти ніби знаєш тему, але в момент відповіді губишся. Саме тому формат коротких голосових у Telegram працює краще за епізодичні довгі уроки: він тренує швидкість реакції, структуру відповіді та сміливість говорити тут і зараз.`,
      `Ключова перевага — миттєвий цикл практики: сказав, отримав фідбек, перефразував, сказав краще. За 10–15 хвилин у тебе проходить кілька повних ітерацій, а не одна спроба на тиждень. Така щоденна практика розмовної мови знімає бар’єр і поступово робить правильні конструкції автоматичними.`,
      `Тобі не потрібно шукати окремий час на дзвінок, узгоджувати графіки чи входити в нові додатки. Telegram уже в твоєму щоденному ритмі, тому поріг входу мінімальний. Це критично для дорослих людей із роботою, сім’єю та нерівномірним темпом дня. Низьке тертя = стабільна звичка, а стабільна звичка = реальний speaking progress.`,
      `Формат також добре масштабується за рівнями. Якщо ти Beginner, можна працювати короткими репліками і концентруватися на найважливіших помилках. Якщо ти Intermediate або Advanced, додаєш аргументацію, нюанси, колокації, точні часові форми та більш природний ритм. Той самий процес залишається, але складність росте разом із тобою.`,
      `Для багатьох учнів найсильніший ефект дають побутові сценарії: банк, лікар, оренда, транспорт, робочі запити. Це не “абстрактна тема з підручника”, а мова, яку ти реально застосовуєш. Коли ти бачиш, що фраза працює в реальній ситуації, мотивація різко зростає, а страх помилки зменшується.`,
      `З ${teacherName} ти отримуєш не випадковий чат-бот, а формат з чіткою педагогічною логікою: коротка спроба, прицільне виправлення, повтор у контексті та наступне питання. Через кілька тижнів ти зазвичай помічаєш конкретні зміни: відповіді стають швидшими, думки — чистішими, а мовний бар’єр — значно слабшим.`
    ],
    faqTitle: 'FAQ',
    faqItems: [
      {
        question: `Це більше про grammar чи про speaking practice ${targetGenitive}?`,
        answer: 'Фокус саме на speaking: граматика подається як практичне виправлення в реальному діалозі.'
      },
      {
        question: 'Скільки часу потрібно щодня?',
        answer: 'Оптимально 10–15 хвилин щодня. Регулярність важливіша за довгі, але рідкі сесії.'
      },
      {
        question: 'Чи потрібно бронювати уроки?',
        answer: 'Ні. Практика повністю асинхронна в Telegram — коли тобі зручно.'
      },
      {
        question: 'Підійде для початківця?',
        answer: 'Так. Почни з коротких повідомлень і поступово переходь до довших відповідей.'
      },
      {
        question: 'Чи буде фідбек по вимові?',
        answer: 'Так, фокус є і на вимові, і на плавності, і на природності фраз.'
      },
      {
        question: 'Чи можна готуватися до співбесіди?',
        answer: 'Так. Є окремі сценарії для самопрезентації, досвіду, кейсів і follow-up питань.'
      },
      {
        question: 'Чи підходить для переїзду?',
        answer: 'Так. Відпрацьовуються типові сценарії документів, оренди, медицини та сервісів.'
      },
      {
        question: 'Чим це краще за звичайний чат-бот?',
        answer: 'Тут є системний цикл: говориш, отримуєш точний фідбек, одразу застосовуєш кращі фрази.'
      },
      {
        question: 'Можна змінити викладача пізніше?',
        answer: 'Так. У будь-який момент можна перейти до списку викладачів і обрати інший стиль.'
      },
      {
        question: 'Як найшвидше побачити прогрес?',
        answer: 'Говори щодня, повторюй виправлені фрази і відповідай повними реченнями на follow-up питання.'
      }
    ],
    otherTeachersTitle: 'Обрати іншого викладача'
  };
}

function buildGermanContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'de') || getTeacherName(teacher, 'en') || 'Lehrkraft';
  const targetLanguage = languageForm.display || 'Englisch';

  return {
    metaTitle: `${targetLanguage} Sprechpraxis in Telegram mit ${teacherName} | AI Language School`,
    metaDescription: `Trainiere gesprochenes ${targetLanguage} in Telegram: kurze Voice-Nachrichten, sofortige Korrekturen, natürlichere Formulierungen und klare Hinweise. Starte in einer Minute mit ${teacherName}.`,
    h1: `${targetLanguage} Sprechpraxis auf Telegram mit ${teacherName}`,
    heroLead: `Übe echte Gespräche auf ${targetLanguage} direkt in Telegram. Du sendest eine kurze Sprachnachricht, und ${teacherName} antwortet mit einer korrigierten, natürlicheren Version, die du sofort übernehmen kannst.`,
    heroOutcome: `So baust du alltagstaugliche Sprachsicherheit auf: klarere Aussprache, schnellere Antworten und weniger Hemmungen bei Arbeit, Interviews, Reisen und im Alltag.`,
    coreBullets: [
      'Sofortige Korrekturen mit konkreten Alternativen, die du direkt wiederverwenden kannst.',
      'Fokus auf Aussprache, Sprachfluss und natürliche Formulierungen im Dialog.',
      'Tägliche Mikro-Praxis in Telegram, die auch mit vollem Kalender realistisch bleibt.'
    ],
    howTitle: 'So funktioniert es',
    howSteps: [
      {
        title: '1. Sende eine echte Sprachnachricht',
        description: 'Sprich über deinen Alltag, Pläne oder ein reales Problem. Kein Skript nötig - sprich in deinem aktuellen Niveau.'
      },
      {
        title: '2. Erhalte Korrektur und bessere Version',
        description: `Du bekommst eine präzisere und natürlichere Formulierung plus kurze Erklärung, was du sofort verbessern kannst.`
      },
      {
        title: '3. Führe den Dialog weiter',
        description: 'Jede Antwort endet mit einer Anschlussfrage. So bleibst du im Sprechen und baust täglich Sicherheit auf.'
      }
    ],
    forWhoTitle: 'Für wen ist das geeignet?',
    forWhoIntro: `${teacherName} ist für Lernende gemacht, die praktische Ergebnisse im gesprochenen ${targetLanguage} brauchen.`,
    forWhoItems: [
      {
        title: 'Berufliche Kommunikation',
        description: 'Trainiere Updates, kurze Calls, Rückfragen und klare Argumentation für den Arbeitsalltag.'
      },
      {
        title: 'Vorstellungsgespräche',
        description: 'Übe Selbstvorstellung, Erfahrung, Projektergebnisse und Follow-up-Fragen mit natürlichem Sprachrhythmus.'
      },
      {
        title: 'Alltag und Umzug',
        description: 'Trainiere Sprache für Miete, Bank, Arzt, Termine und typische Behördensituationen.'
      },
      {
        title: 'Reisen',
        description: 'Lerne hochfrequente Formulierungen für Flughafen, Hotel, Restaurant und spontane Alltagssituationen.'
      }
    ],
    dialoguesTitle: 'Dialogbeispiel',
    dialoguesIntro: 'Ein kurzes, realistisches Chat-Beispiel. Sprachnachricht → bessere Antwort → Regel-Erklärung → Optionen für die nächste Nachricht.',
    deepDiveTitle: `Wie du mit Telegram wirklich flüssiger in ${targetLanguage} sprichst`,
    deepDiveParagraphs: [
      `Die meisten Lernenden scheitern nicht an fehlenden Regeln, sondern am Abrufen der richtigen Formulierung unter Zeitdruck. Genau hier setzt dieses Format an: kurze, echte Sprechversuche, sofortige Korrektur und direktes Wiederholen im selben Kontext.`,
      `Der Kern ist ein schneller Lernzyklus: sprechen, korrigieren, neu formulieren, weitersprechen. Dadurch sammelst du in wenigen Minuten mehrere sinnvolle Wiederholungen statt einer langen passiven Lerneinheit.`,
      `Telegram reduziert die Einstiegshürde. Du musst keine Calls planen und keine zusätzliche App öffnen. Diese niedrige Reibung macht tägliche Kontinuität realistisch - und Kontinuität ist der wichtigste Hebel für Speaking Progress.`,
      `Wichtig ist die Qualität des Feedbacks: nicht nur „so klingt es besser“, sondern konkrete Alternativen mit kurzer Regel-Logik. Dadurch entwickelst du schneller ein Sprachgefühl für natürliche Muster.`,
      `Das Format skaliert mit deinem Niveau. Auf A1-A2 konzentrierst du dich auf kurze, klare Antworten. Auf B1-C1 trainierst du komplexere Struktur, Kollokationen und präzise Argumentation für Beruf und Gespräche.`,
      `Mit ${teacherName} baust du einen klaren Ablauf auf: sprechen, korrigieren, wiederverwenden, wiederholen. Nach wenigen Wochen berichten Lernende meist von weniger Zögern, flüssigerem Satzbau und mehr Sicherheit in echten Situationen.`
    ],
    faqTitle: 'FAQ',
    faqItems: [
      {
        question: `Ist das echte ${targetLanguage}-Sprechpraxis oder nur Grammatik?`,
        answer: 'Der Fokus liegt klar auf Sprechen. Grammatik erscheint als praktische Korrektur im realen Dialog.'
      },
      {
        question: 'Wie viel Zeit sollte ich täglich einplanen?',
        answer: '10–15 Minuten pro Tag reichen aus. Regelmäßigkeit ist wichtiger als seltene lange Sessions.'
      },
      {
        question: 'Muss ich Unterrichtstermine buchen?',
        answer: 'Nein. Die Praxis läuft asynchron in Telegram - wann immer es für dich passt.'
      },
      {
        question: 'Ist das auch für Anfänger geeignet?',
        answer: 'Ja. Starte mit sehr kurzen Nachrichten und baue Schritt für Schritt aus.'
      },
      {
        question: 'Bekomme ich auch Hilfe bei Aussprache?',
        answer: 'Ja. Das Feedback umfasst Aussprache, Sprachfluss und natürliche Ausdrucksweise.'
      },
      {
        question: 'Hilft das bei der Interviewvorbereitung?',
        answer: 'Ja. Du kannst typische Interviewfragen und strukturierte Antworten gezielt üben.'
      },
      {
        question: 'Ist das für Umzug und Alltag nützlich?',
        answer: 'Ja. Häufige Szenarien wie Miete, Arzt, Bank und Behördengänge sind Teil der Praxis.'
      },
      {
        question: 'Was ist der Unterschied zu generischen Chatbots?',
        answer: 'Hier gibt es einen klaren Lernprozess: Versuch, präzise Korrektur, direkte Wiederverwendung.'
      },
      {
        question: 'Kann ich später die Lehrkraft wechseln?',
        answer: 'Ja. Du kannst jederzeit eine andere Lehrkraft aus der Liste wählen.'
      },
      {
        question: 'Wie sehe ich möglichst schnell Fortschritt?',
        answer: 'Sprich täglich, übernimm korrigierte Formulierungen und antworte vollständig auf Anschlussfragen.'
      }
    ],
    otherTeachersTitle: 'Andere Lehrkraft wählen'
  };
}

function buildItalianContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'it') || getTeacherName(teacher, 'en') || 'insegnante';
  const targetLanguage = languageForm.display || 'inglese';

  return {
    metaTitle: `Pratica di conversazione in ${targetLanguage} su Telegram con ${teacherName} | AI Language School`,
    metaDescription: `Allena il parlato in ${targetLanguage} ogni giorno su Telegram: messaggi vocali, correzioni immediate, frasi naturali e feedback pratico. Inizia in un minuto con ${teacherName}.`,
    h1: `Pratica di conversazione in ${targetLanguage} su Telegram con ${teacherName}`,
    heroLead: `Fai pratica di conversazione reale in ${targetLanguage} direttamente su Telegram. Invia un vocale breve e ${teacherName} ti risponde con una versione corretta e più naturale, pronta da riutilizzare subito.`,
    heroOutcome: `Migliori la fluidità in modo pratico: risposte più rapide, pronuncia più chiara e meno blocchi in lavoro, colloqui, viaggi e vita quotidiana.`,
    coreBullets: [
      'Correzione immediata con alternative pronte da riutilizzare nella risposta successiva.',
      'Supporto su pronuncia, scorrevolezza e naturalezza della frase.',
      'Micro-pratica quotidiana in Telegram, sostenibile anche con agenda piena.'
    ],
    howTitle: 'Come funziona',
    howSteps: [
      {
        title: '1. Invia un vocale reale',
        description: 'Parla di una situazione concreta: giornata, lavoro, piano o problema. Nessun copione perfetto, solo lingua viva.'
      },
      {
        title: '2. Ricevi correzione e versione migliore',
        description: `Ottieni una frase più naturale, più chiara e più precisa. ${teacherName} spiega in modo pratico cosa cambiare subito.`
      },
      {
        title: '3. Continua il dialogo ogni giorno',
        description: 'Ogni risposta chiude con una domanda successiva: così continui a parlare e trasformi la pratica in abitudine.'
      }
    ],
    forWhoTitle: 'Per chi è',
    forWhoIntro: `Questo formato è ideale per chi cerca risultati reali nel parlato in ${targetLanguage}.`,
    forWhoItems: [
      {
        title: 'Comunicazione professionale',
        description: 'Allenati su aggiornamenti, call brevi, chiarimenti e risposte professionali in modo semplice e naturale.'
      },
      {
        title: 'Preparazione colloquio',
        description: 'Prova presentazione, esperienza, risultati, motivazione e domande finali con una struttura che funziona davvero.'
      },
      {
        title: 'Trasferimento e vita pratica',
        description: 'Esercita lingua utile per affitto, banca, medico, documenti e servizi quotidiani dove serve chiarezza immediata.'
      },
      {
        title: 'Viaggi',
        description: 'Impara frasi ad alta frequenza per aeroporto, hotel, trasporti e richieste urgenti in contesti reali.'
      }
    ],
    dialoguesTitle: 'Esempio di dialogo',
    dialoguesIntro: 'Un esempio breve e realistico. Messaggio vocale → risposta più naturale → spiegazione della regola → opzioni per il prossimo messaggio.',
    deepDiveTitle: `Come migliorare davvero il parlato in ${targetLanguage} con Telegram`,
    deepDiveParagraphs: [
      `Molti studenti non si bloccano perché non conoscono le regole, ma perché non riescono a recuperare velocemente la frase giusta quando serve. Per questo la pratica breve e frequente funziona meglio delle sessioni lunghe e sporadiche. Alleni risposta rapida, struttura della frase e fiducia nello stesso momento.`,
      `Il ciclo è semplice e potente: parli, ricevi correzione, riformuli, continui. In pochi minuti fai più iterazioni utili rispetto a una lezione passiva. Questo approccio crea automatismi reali: inizi a produrre frasi più pulite senza dover tradurre mentalmente parola per parola ogni volta.`,
      `Telegram riduce attrito. Non devi prenotare chiamate, non devi aprire strumenti aggiuntivi, non devi aspettare il “momento perfetto”. Puoi esercitarti tra un impegno e l'altro. Questa praticità è decisiva per mantenere continuità, soprattutto se lavori o vivi ritmi irregolari.`,
      `Anche la qualità del feedback conta. Non basta sentirsi dire “così suona meglio”. Serve capire quale parte cambiare e perché. Con spiegazioni concrete e alternative immediate, impari più in fretta e sviluppi sensibilità alle strutture naturali della lingua in contesto reale.`,
      `Il formato si adatta al livello. Se sei A1-A2, puoi iniziare con messaggi molto brevi e obiettivi semplici. Se sei B1-C1, puoi lavorare su risposte più ricche, collocazioni, tono professionale e gestione di domande complesse. Lo schema resta stabile, cresce solo la profondità.`,
      `Con ${teacherName} costruisci una progressione chiara: pratica quotidiana, correzione mirata, riuso delle frasi corrette e continuità. Dopo alcune settimane, gli studenti notano in genere tre miglioramenti: meno esitazione, ritmo più fluido e maggiore controllo in situazioni reali.`
    ],
    faqTitle: 'FAQ',
    faqItems: [
      {
        question: `È pratica di conversazione in ${targetLanguage} o solo grammatica?`,
        answer: 'È conversazione prima di tutto: la grammatica appare come correzione utile dentro dialoghi reali.'
      },
      {
        question: 'Quanto tempo devo praticare al giorno?',
        answer: 'Bastano 10–15 minuti quotidiani. La costanza vale più delle sessioni lunghe occasionali.'
      },
      {
        question: 'Devo prenotare lezioni?',
        answer: 'No. La pratica è asincrona in Telegram, quando vuoi tu.'
      },
      {
        question: 'Va bene anche per principianti?',
        answer: 'Sì. Si parte da messaggi brevi e si aumenta gradualmente.'
      },
      {
        question: 'C’è supporto anche sulla pronuncia?',
        answer: 'Sì, il feedback include pronuncia, fluidità e naturalezza.'
      },
      {
        question: 'Posso usarlo per preparare un colloquio?',
        answer: 'Sì. Puoi allenare presentazione, esperienza e domande tipiche in modo progressivo.'
      },
      {
        question: 'È utile per trasferimento e burocrazia?',
        answer: 'Sì. Sono inclusi scenari pratici come affitto, medico, banca e servizi.'
      },
      {
        question: 'In cosa è diverso da un chatbot generico?',
        answer: 'Qui c’è un ciclo didattico chiaro: tentativo, correzione mirata, riuso immediato.'
      },
      {
        question: 'Posso cambiare insegnante?',
        answer: 'Sì, puoi scegliere un altro stile in qualsiasi momento dalla lista insegnanti.'
      },
      {
        question: 'Come ottengo risultati più veloci?',
        answer: 'Parla ogni giorno, riusa le frasi corrette e rispondi con frasi complete alle domande di follow-up.'
      }
    ],
    otherTeachersTitle: 'Scegli un altro insegnante'
  };
}

function buildSpanishContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'es') || getTeacherName(teacher, 'en') || 'profesor';
  const targetLanguage = languageForm.display || 'inglés';
  const base = buildEnglishContent(teacher, languageForm);

  return {
    ...base,
    metaTitle: `Práctica de conversación en ${targetLanguage} por Telegram con ${teacherName} | AI Language School`,
    metaDescription: `Practica ${targetLanguage} hablado en Telegram con correcciones al instante, frases naturales y microlecciones diarias. Empieza en un minuto con ${teacherName}.`,
    h1: `Práctica de conversación en ${targetLanguage} por Telegram con ${teacherName}`,
    heroLead: `Practica conversaciones reales en ${targetLanguage} dentro de Telegram. Envías un audio corto y ${teacherName} te responde con una versión corregida y más natural que puedes reutilizar al instante.`,
    heroOutcome: `Ganas fluidez útil para la vida real: respuestas más rápidas, pronunciación más clara y menos bloqueos en trabajo, entrevistas, viajes y gestiones diarias.`,
    dialoguesTitle: 'Ejemplo de diálogo',
    dialoguesIntro: 'Un ejemplo breve y realista. Mensaje de voz → respuesta más natural → explicación de la regla → opciones para tu siguiente mensaje.',
    otherTeachersTitle: 'Elige otro profesor'
  };
}

function buildPortugueseContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'pt') || getTeacherName(teacher, 'en') || 'professor';
  const targetLanguage = languageForm.display || 'inglês';
  const base = buildEnglishContent(teacher, languageForm);

  return {
    ...base,
    metaTitle: `Prática de conversação em ${targetLanguage} no Telegram com ${teacherName} | AI Language School`,
    metaDescription: `Pratique ${targetLanguage} falado no Telegram com correções imediatas, frases naturais e microlições diárias. Comece em um minuto com ${teacherName}.`,
    h1: `Prática de conversação em ${targetLanguage} no Telegram com ${teacherName}`,
    heroLead: `Pratique conversas reais em ${targetLanguage} direto no Telegram. Você envia um áudio curto e ${teacherName} responde com uma versão corrigida e mais natural para reutilizar na hora.`,
    heroOutcome: `Você ganha fluência prática para o dia a dia: respostas mais rápidas, pronúncia mais clara e menos travas em trabalho, entrevistas, viagens e rotina.`,
    dialoguesTitle: 'Exemplo de diálogo',
    dialoguesIntro: 'Um exemplo curto e realista. Mensagem de voz → resposta mais natural → explicação da regra → opções para a próxima mensagem.',
    otherTeachersTitle: 'Escolha outro professor'
  };
}

function buildTurkishContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'tr') || getTeacherName(teacher, 'en') || 'öğretmen';
  const targetLanguage = languageForm.display || 'İngilizce';
  const base = buildEnglishContent(teacher, languageForm);

  return {
    ...base,
    metaTitle: `${teacherName} ile Telegram'da ${targetLanguage} konuşma pratiği | AI Language School`,
    metaDescription: `Telegram'da ${targetLanguage} konuşma pratiği yapın: anlık düzeltmeler, daha doğal ifadeler ve günlük mikro derslerle ${teacherName} ile bir dakikada başlayın.`,
    h1: `${teacherName} ile Telegram'da ${targetLanguage} konuşma pratiği`,
    heroLead: `Telegram içinde gerçek ${targetLanguage} konuşmalarını pratik yapın. Kısa bir sesli mesaj gönderin; ${teacherName} size anında düzeltilmiş ve daha doğal bir versiyonla dönsün.`,
    heroOutcome: `İş, mülakat, seyahat ve günlük hayatta daha hızlı cevaplar, daha net telaffuz ve daha az çekinmeyle akıcı konuşun.`,
    howTitle: 'Nasıl çalışır',
    forWhoTitle: 'Kimler için uygun',
    dialoguesTitle: 'Diyalog örneği',
    dialoguesIntro: 'Kısa ve gerçekçi bir sohbet örneği. Sesli mesaj -> daha doğal cevap -> kural açıklaması -> sonraki mesaj seçenekleri.',
    deepDiveTitle: `Telegram ile gerçek ${targetLanguage} akıcılığı nasıl gelişir`,
    faqTitle: 'SSS',
    otherTeachersTitle: 'Başka bir öğretmen seç'
  };
}

export function getTeacherSeoContent(teacher, localeInput) {
  const locale = normalizeLocale(localeInput) || 'en';
  const languageForm = getLanguageForm(locale, teacher?.learningLanguage);

  if (locale === 'de') return buildGermanContent(teacher, languageForm);
  if (locale === 'es') return buildSpanishContent(teacher, languageForm);
  if (locale === 'pt') return buildPortugueseContent(teacher, languageForm);
  if (locale === 'uk') return buildUkrainianContent(teacher, languageForm);
  if (locale === 'it') return buildItalianContent(teacher, languageForm);
  if (locale === 'tr') return buildTurkishContent(teacher, languageForm);
  return buildEnglishContent(teacher, languageForm);
}
