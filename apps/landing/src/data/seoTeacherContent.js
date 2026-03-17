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
  },
  hi: {
    en: { display: 'अंग्रेज़ी' },
    de: { display: 'जर्मन' },
    es: { display: 'स्पेनिश' },
    it: { display: 'इतालवी' },
    pl: { display: 'पोलिश' },
    pt: { display: 'पुर्तगाली' },
    uk: { display: 'यूक्रेनी' }
  },
  ar: {
    en: { display: 'الإنجليزية' },
    de: { display: 'الألمانية' },
    es: { display: 'الإسبانية' },
    it: { display: 'الإيطالية' },
    pl: { display: 'البولندية' },
    pt: { display: 'البرتغالية' },
    uk: { display: 'الأوكرانية' }
  },
  id: {
    en: { display: 'Inggris' },
    de: { display: 'Jerman' },
    es: { display: 'Spanyol' },
    it: { display: 'Italia' },
    pl: { display: 'Polandia' },
    pt: { display: 'Portugis' },
    uk: { display: 'Ukraina' }
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
    metaTitle: `${targetLanguage} speaking practice in Telegram | AI Language School`,
    metaDescription: `Practice spoken ${targetLanguage} in Telegram with instant corrections, natural phrasing, and daily micro-lessons. Start in one minute.`,
    h1: `${targetLanguage} speaking practice on Telegram`,
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
    metaTitle: `Практика розмовної ${targetGenitive} в Telegram — AI викладач | AI Language School`,
    metaDescription: `Практикуй розмовну ${targetAccusative} щодня: надсилай голосові в Telegram, отримуй миттєві виправлення, природні фрази та чіткий фідбек. Почни за 1 хвилину.`,
    h1: `Практика розмовної ${targetGenitive} у Telegram`,
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
    metaTitle: `${targetLanguage} Sprechpraxis in Telegram | AI Language School`,
    metaDescription: `Trainiere gesprochenes ${targetLanguage} in Telegram: kurze Voice-Nachrichten, sofortige Korrekturen, natürlichere Formulierungen und klare Hinweise. Starte in einer Minute.`,
    h1: `${targetLanguage} Sprechpraxis auf Telegram`,
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
    metaTitle: `Pratica di conversazione in ${targetLanguage} su Telegram | AI Language School`,
    metaDescription: `Allena il parlato in ${targetLanguage} ogni giorno su Telegram: messaggi vocali, correzioni immediate, frasi naturali e feedback pratico. Inizia in un minuto.`,
    h1: `Pratica di conversazione in ${targetLanguage} su Telegram`,
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
    metaTitle: `Práctica de conversación en ${targetLanguage} por Telegram | AI Language School`,
    metaDescription: `Practica ${targetLanguage} hablado en Telegram con correcciones al instante, frases naturales y microlecciones diarias. Empieza en un minuto.`,
    h1: `Práctica de conversación en ${targetLanguage} por Telegram`,
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
    metaTitle: `Prática de conversação em ${targetLanguage} no Telegram | AI Language School`,
    metaDescription: `Pratique ${targetLanguage} falado no Telegram com correções imediatas, frases naturais e microlições diárias. Comece em um minuto.`,
    h1: `Prática de conversação em ${targetLanguage} no Telegram`,
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

  return {
    metaTitle: `Telegram'da ${targetLanguage} konuşma pratiği | AI Language School`,
    metaDescription: `Telegram'da her gün ${targetLanguage} konuşma pratiği yapın: kısa sesli mesajlar gönderin, anında düzeltmeler alın, daha doğal kalıplar öğrenin ve bir dakikada başlayın.`,
    h1: `Telegram'da ${targetLanguage} konuşma pratiği`,
    heroLead: `Telegram içinde gerçek ${targetLanguage} konuşmalarını pratik yapın. Kısa bir sesli mesaj gönderin; ${teacherName} size hemen düzeltilmiş ve daha doğal bir versiyon göndersin, siz de bunu bir sonraki mesajda tekrar kullanabilesiniz.`,
    heroOutcome: `İş, mülakat, seyahat ve günlük hayatta daha hızlı yanıtlar, daha net telaffuz ve daha az çekinmeyle daha özgüvenli konuşun.`,
    coreBullets: [
      'Bir sonraki mesajda hemen yeniden kullanabileceğiniz net düzeltmeler ve daha güçlü alternatifler.',
      'Telaffuz, akıcılık ve doğal ifade kurma konusunda doğrudan sohbet içinde pratik destek.',
      'Telegram içinde 10–15 dakikalık günlük mikro pratik: yoğun programda bile sürdürülebilir ilerleme.'
    ],
    howTitle: 'Nasıl çalışır',
    howSteps: [
      {
        title: '1. Gerçek bir sesli mesaj gönder',
        description: 'Günün, işin, planların ya da gerçek bir durum hakkında 1–2 cümle söyle. Kusursuz bir metin hazırlamana gerek yok; mevcut seviyende doğal konuşman yeterli.'
      },
      {
        title: '2. Anında düzeltme ve daha iyi bir versiyon al',
        description: `Aynı fikrin daha temiz, daha doğru ve daha doğal bir biçimini görürsün. ${teacherName}, neyi neden değiştirmen gerektiğini de kısa şekilde açıklar.`
      },
      {
        title: '3. Diyaloğu sürdür ve alışkanlık oluştur',
        description: 'Her yanıtın sonunda yeni bir soru ya da ipucu olur. Böylece tek cümlede kalmaz, her gün konuşma kasını biraz daha güçlendirirsin.'
      }
    ],
    forWhoTitle: 'Kimler için uygun',
    forWhoIntro: `${teacherName}, sadece pasif çalışma değil, ${targetLanguage} konuşmada gerçek sonuç isteyen öğrenciler için tasarlandı.`,
    forWhoItems: [
      {
        title: 'İş iletişimi',
        description: 'Toplantı güncellemeleri, kısa aramalar, follow-up mesajları ve profesyonel yanıtlar üzerinde çalış; net ve doğal duyul.'
      },
      {
        title: 'Mülakat hazırlığı',
        description: 'Kendini tanıtma, deneyim, güçlü yönler, proje örnekleri ve yaygın mülakat soruları için kısa ama güçlü cevaplar kur.'
      },
      {
        title: 'Seyahat ve yeni bir ülkeye taşınma',
        description: 'Havalimanı, otel, kira, evrak, randevu ve günlük hizmet durumlarında işine yarayacak dili pratik et.'
      },
      {
        title: 'Günlük yaşam',
        description: 'Alışveriş, ulaşım, doktor, banka ve sıradan sohbetlerde hızlı ve anlaşılır tepki vermeyi öğren.'
      }
    ],
    dialoguesTitle: 'Diyalog örneği',
    dialoguesIntro: 'Kısa ve gerçekçi bir sohbet örneği. Sesli mesaj → daha iyi yanıt → kural açıklaması → bir sonraki mesaj için seçenekler.',
    deepDiveTitle: `Telegram ile gerçek ${targetLanguage} akıcılığı nasıl gelişir`,
    deepDiveParagraphs: [
      `Çoğu öğrenci kelime bilmediği için değil, doğru ifadeyi doğru anda yeterince hızlı kuramadığı için zorlanır. Telegram'daki kısa ama düzenli konuşma pratiği tam burada işe yarar. Baskının gerçekten hissedildiği yerde çalışırsın: kısa, hazırlıksız ve gerçek cevaplar.`,
      `Bu yöntemin döngüsü nettir: konuş, düzeltme al, daha iyi cümleyi tekrar et, sonra devam et. 10–15 dakika içinde birkaç faydalı tekrar yaparsın. Bu tekrarlar zamanla çekinmeyi azaltır ve cümle akışını doğal hale getirir.`,
      `Telegram formatının en büyük avantajı düşük sürtünmedir. Ders ayarlaman, arama planlaman ya da yeni bir uygulama açman gerekmez. Kısa boşluklarda bile pratik yapabilirsin. Uzun vadede akıcılığı asıl oluşturan şey de bu tutarlılıktır.`,
      `Geri bildirimin kalitesi çok önemlidir. Sadece “bu daha iyi” demek yetmez. Somut alternatifler ve kısa, kural temelli açıklamalar aldığında neyin neden değiştiğini anlarsın. Böylece dil kalıplarını daha hızlı fark etmeye başlarsın.`,
      `Bu format farklı seviyelerde işe yarar. Başlangıç seviyesindeysen kısa mesajlar ve tek bir düzeltme üzerinde kalabilirsin. Orta ya da ileri seviyedeysen daha uzun cevaplar, iş iletişimi, mülakat yapısı ve doğal collocation'lar üzerinde çalışabilirsin.`,
      `${teacherName} ile ilerleme yolu nettir: konuş, düzeltme al, daha iyi cümleleri yeniden kullan ve her gün devam et. Birkaç hafta sonra genelde üç değişim görülür: daha az çekinme, daha temiz cümle akışı ve gerçek durumlarda daha hızlı tepki.`
    ],
    faqTitle: 'SSS',
    faqItems: [
      {
        question: `Bu gerçekten ${targetLanguage} konuşma pratiği mi, yoksa daha çok gramer mi?`,
        answer: 'Ana odak konuşmadır. Gramer yalnızca gerçek diyalog içindeki pratik düzeltmeler olarak görünür.'
      },
      {
        question: 'Her gün ne kadar zaman ayırmalıyım?',
        answer: 'Günde 10–15 dakika ile başla. Uzun ama seyrek oturumlardan daha önemli olan şey düzenliliktir.'
      },
      {
        question: 'Ders planlamam gerekiyor mu?',
        answer: 'Hayır. Pratik tamamen Telegram içinde asenkron ilerler; istediğin uygun anda yapabilirsin.'
      },
      {
        question: 'Başlangıç seviyesindekiler de kullanabilir mi?',
        answer: 'Evet. Başlangıç seviyesindekiler kısa mesajlarla başlayabilir ve basit ama etkili düzeltmeler alabilir.'
      },
      {
        question: 'Telaffuz için de geri bildirim geliyor mu?',
        answer: 'Evet. Geri bildirim yalnızca metin düzeltmesi değil; telaffuz, akıcılık ve doğal ifade kurma desteği de içerir.'
      },
      {
        question: 'Mülakat hazırlığı için faydalı mı?',
        answer: 'Evet. Kendini tanıtma, deneyim, güçlü yönler ve follow-up yanıtları tekrar tekrar çalışabilirsin.'
      },
      {
        question: 'Taşınma veya seyahat senaryolarını çalışabilir miyim?',
        answer: 'Evet. Kira, randevu, ulaşım, otel, evrak ve günlük hizmetler gibi yaygın durumlar buna dahildir.'
      },
      {
        question: 'Bunu sıradan chatbotlardan farklı yapan ne?',
        answer: 'Bu format düzeltme odaklıdır: her yanıt bir sonraki konuşma denemeni daha güçlü hale getirir, sadece sohbet etmiş olmazsın.'
      },
      {
        question: 'Sonra başka bir öğretmen seçebilir miyim?',
        answer: 'Evet. İstediğin zaman öğretmenler listesini açıp başka bir öğretmen tarzına geçebilirsin.'
      },
      {
        question: 'En hızlı ilerleme için ne yapmalıyım?',
        answer: 'Her gün konuş, düzeltilmiş cümleleri yeniden kullan ve her follow-up sorusuna tam cümlelerle yanıt ver.'
      }
    ],
    otherTeachersTitle: 'Başka bir öğretmen seç'
  };
}

function buildHindiContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'hi') || getTeacherName(teacher, 'en') || 'शिक्षक';
  const targetLanguage = languageForm.display || 'अंग्रेज़ी';

  return {
    metaTitle: `Telegram पर ${targetLanguage} बोलने की प्रैक्टिस | AI Language School`,
    metaDescription: `Telegram पर रोज़ ${targetLanguage} बोलने की प्रैक्टिस करें: छोटे वॉइस मैसेज भेजें, तुरंत सुधार पाएँ, अधिक स्वाभाविक वाक्य सीखें और एक मिनट में शुरू करें।`,
    h1: `Telegram पर ${targetLanguage} बोलने की प्रैक्टिस`,
    heroLead: `Telegram के अंदर असली ${targetLanguage} बातचीत की प्रैक्टिस करें। एक छोटा वॉइस मैसेज भेजें, और ${teacherName} आपको तुरंत सुधरा हुआ और अधिक स्वाभाविक जवाब भेजेगा जिसे आप अगली बार सीधे इस्तेमाल कर सकें।`,
    heroOutcome: `काम, इंटरव्यू, यात्रा और रोज़मर्रा की स्थितियों में तेज़ जवाब, साफ़ उच्चारण और कम झिझक के साथ ज़्यादा आत्मविश्वास से बोलें।`,
    coreBullets: [
      'तुरंत सुधार और ऐसे बेहतर विकल्प, जिन्हें आप अगली ही पंक्ति में दोहरा सकें।',
      'उच्चारण, बोलने के प्रवाह और स्वाभाविक वाक्य-विन्यास पर व्यावहारिक मदद, सीधे चैट रूप में।',
      'Telegram में 10–15 मिनट की छोटी दैनिक प्रैक्टिस, जिसे व्यस्त दिनचर्या में भी जारी रखना आसान है।'
    ],
    howTitle: 'यह कैसे काम करता है',
    howSteps: [
      {
        title: '1. असली वॉइस मैसेज भेजें',
        description: 'अपने दिन, काम, योजना या किसी वास्तविक स्थिति के बारे में 1–2 वाक्य बोलें। स्क्रिप्ट लिखने की ज़रूरत नहीं है, बस अपने मौजूदा स्तर पर स्वाभाविक बोलें।'
      },
      {
        title: '2. तुरंत सुधार और बेहतर रूप पाएँ',
        description: `आपको उसी बात का अधिक साफ़, सही और स्वाभाविक रूप मिलता है। ${teacherName} संक्षेप में यह भी बताती हैं कि क्या बदलना है और क्यों।`
      },
      {
        title: '3. बातचीत जारी रखें और आदत बनाएँ',
        description: 'हर जवाब के अंत में अगला सवाल या संकेत होता है, ताकि आप एक वाक्य पर न रुकें। इसी तरह रोज़ बोलने की आदत बनती है।'
      }
    ],
    forWhoTitle: 'यह किन लोगों के लिए है',
    forWhoIntro: `${teacherName} उन सीखने वालों के लिए है जिन्हें सिर्फ पढ़ाई नहीं, बल्कि ${targetLanguage} में असली बोलने के नतीजे चाहिए।`,
    forWhoItems: [
      {
        title: 'काम की बातचीत',
        description: 'मीटिंग अपडेट, छोटे कॉल, अगली प्रतिक्रिया और पेशेवर जवाबों की प्रैक्टिस करें, ताकि आप साफ़ और स्वाभाविक लगें।'
      },
      {
        title: 'इंटरव्यू की तैयारी',
        description: 'अपना परिचय, अनुभव, खूबियाँ, प्रोजेक्ट अनुभव और आम इंटरव्यू सवालों पर छोटे लेकिन मजबूत जवाब बनाइए।'
      },
      {
        title: 'यात्रा और नए देश में बसना',
        description: 'हवाई अड्डा, होटल, किराया, दस्तावेज़, अपॉइंटमेंट और रोज़मर्रा की सेवा स्थितियों के लिए उपयोगी भाषा की प्रैक्टिस करें।'
      },
      {
        title: 'रोज़मर्रा का जीवन',
        description: 'खरीदारी, यात्रा, डॉक्टर, बैंक और सामान्य बातचीत जैसी स्थितियों में जल्दी और साफ़ प्रतिक्रिया देना सीखें।'
      }
    ],
    dialoguesTitle: 'डायलॉग उदाहरण',
    dialoguesIntro: 'एक छोटा और यथार्थवादी चैट उदाहरण। वॉइस मैसेज → बेहतर जवाब → नियम की व्याख्या → अगला संदेश विकल्प।',
    deepDiveTitle: `Telegram के साथ असली ${targetLanguage} धाराप्रवाह बोलना कैसे बनता है`,
    deepDiveParagraphs: [
      `ज़्यादातर सीखने वाले इसलिए नहीं अटकते कि उन्हें शब्द नहीं आते, बल्कि इसलिए कि सही वाक्य सही समय पर जल्दी नहीं बनता। यही वजह है कि Telegram पर छोटी, लगातार बोलने की प्रैक्टिस असरदार होती है। आप उसी जगह अभ्यास करते हैं जहाँ असली दबाव आता है: छोटी, बिना तैयारी वाली प्रतिक्रियाएँ।`,
      `इस तरीके का क्रम सीधा है: बोलो, सुधार पाओ, बेहतर वाक्य दोहराओ, फिर आगे बोलो। 10–15 मिनट में आप कई उपयोगी दोहराव कर लेते हैं। यही अभ्यास धीरे-धीरे झिझक कम करता है और वाक्यों का स्वाभाविक प्रवाह बनाता है।`,
      `Telegram रूप का सबसे बड़ा फायदा कम रुकावट है। आपको पाठ तय नहीं करना, कॉल तय नहीं करना और नया ऐप खोलना नहीं पड़ता। जब भी थोड़ा समय मिले, आप प्रैक्टिस कर सकते हैं। यही निरंतरता लंबे समय में धाराप्रवाह बोलना बनाती है।`,
      `प्रतिक्रिया की गुणवत्ता बहुत मायने रखती है। सिर्फ “यह बेहतर लगता है” सुनना काफ़ी नहीं होता। जब आपको ठोस विकल्प और छोटे नियम-आधारित समझाव मिलते हैं, तब आप समझते हैं कि क्या बदला और क्यों बदला। इसी से भाषा के पैटर्न जल्दी पकड़ में आते हैं।`,
      `यह तरीका अलग-अलग स्तरों पर काम करता है। अगर आप शुरुआती हैं, तो छोटे संदेश और एक समय में एक सुधार पर ध्यान दे सकते हैं। अगर आप मध्यम या उन्नत स्तर पर हैं, तो लंबे जवाब, काम की बातचीत, इंटरव्यू की संरचना और स्वाभाविक शब्द-समूहों की प्रैक्टिस कर सकते हैं।`,
      `${teacherName} के साथ प्रगति का रास्ता साफ़ है: बोलें, सुधार पाएँ, बेहतर वाक्य फिर से इस्तेमाल करें और रोज़ दोहराएँ। कुछ हफ्तों में आम तौर पर तीन बदलाव दिखते हैं: कम झिझक, ज़्यादा साफ़ वाक्य प्रवाह और वास्तविक स्थितियों में तेज़ प्रतिक्रिया।`
    ],
    faqTitle: 'अक्सर पूछे जाने वाले सवाल',
    faqItems: [
      {
        question: `क्या यह सच में ${targetLanguage} बोलने की प्रैक्टिस है या सिर्फ व्याकरण?`,
        answer: 'मुख्य फोकस बोलने पर है। व्याकरण केवल वास्तविक संवाद के अंदर व्यावहारिक सुधार के रूप में आती है।'
      },
      {
        question: 'मुझे रोज़ कितना समय देना चाहिए?',
        answer: '10–15 मिनट रोज़ से शुरू करें। लंबी लेकिन कभी-कभार होने वाली बैठकों से अधिक ज़रूरी निरंतरता है।'
      },
      {
        question: 'क्या मुझे पाठ पहले से तय करने होंगे?',
        answer: 'नहीं। प्रैक्टिस पूरी तरह Telegram में अपने समय के अनुसार होती है, इसलिए आप इसे जब चाहें तब कर सकते हैं।'
      },
      {
        question: 'क्या शुरुआती सीखने वाले भी इसका उपयोग कर सकते हैं?',
        answer: 'हाँ। शुरुआती सीखने वाले छोटे संदेश भेज सकते हैं और सरल, उपयोगी सुधारों से शुरुआत कर सकते हैं।'
      },
      {
        question: 'क्या उच्चारण पर भी प्रतिक्रिया मिलती है?',
        answer: 'हाँ। प्रतिक्रिया में उच्चारण, बोलने का प्रवाह और स्वाभाविक वाक्य-विन्यास तीनों शामिल होते हैं।'
      },
      {
        question: 'क्या यह इंटरव्यू की तैयारी के लिए उपयोगी है?',
        answer: 'हाँ। आप अपना परिचय, अनुभव, खूबियाँ और आगे के जवाबों की बार-बार प्रैक्टिस कर सकते हैं।'
      },
      {
        question: 'क्या नए देश में बसने या यात्रा की स्थितियों की प्रैक्टिस कर सकता/सकती हूँ?',
        answer: 'हाँ। आम स्थितियों में किराया, अपॉइंटमेंट, यात्रा, होटल, दस्तावेज़ और रोज़मर्रा की सेवाएँ शामिल हैं।'
      },
      {
        question: 'यह सामान्य चैट बॉट्स से अलग कैसे है?',
        answer: 'यह सुधार-आधारित तरीका है: हर जवाब आपको अगली बार बेहतर बोलने में मदद करता है, सिर्फ सामान्य चैट नहीं करता।'
      },
      {
        question: 'क्या मैं बाद में दूसरा शिक्षक चुन सकता/सकती हूँ?',
        answer: 'हाँ। आप कभी भी शिक्षकों की सूची खोलकर दूसरी शैली चुन सकते हैं।'
      },
      {
        question: 'सबसे तेज़ प्रगति देखने का तरीका क्या है?',
        answer: 'रोज़ बोलें, सुधरे हुए वाक्य दोहराएँ और हर अगला सवाल पूरे वाक्यों में जवाब दें।'
      }
    ],
    otherTeachersTitle: 'दूसरे शिक्षक चुनें'
  };
}

function buildArabicContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'ar') || getTeacherName(teacher, 'en') || 'المعلم';
  const targetLanguage = languageForm.display || 'الإنجليزية';

  return {
    metaTitle: `ممارسة التحدث باللغة ${targetLanguage} على Telegram | AI Language School`,
    metaDescription: `تدرّب يومياً على التحدث باللغة ${targetLanguage} في Telegram: أرسل رسائل صوتية قصيرة، واحصل على تصحيحات فورية، وتعلّم صياغات أكثر طبيعية، وابدأ خلال دقيقة.`,
    h1: `ممارسة التحدث باللغة ${targetLanguage} على Telegram`,
    heroLead: `تدرّب على محادثات حقيقية باللغة ${targetLanguage} مباشرة داخل Telegram. أرسل رسالة صوتية قصيرة، وسيعود ${teacherName} بصياغة مصححة وأكثر طبيعية يمكنك إعادة استخدامها في رسالتك التالية فوراً.`,
    heroOutcome: `طوّر طلاقة عملية للعمل والمقابلات والسفر والحياة اليومية مع ردود أسرع ونطق أوضح وتردد أقل.`,
    coreBullets: [
      'تصحيحات فورية وبدائل أقوى يمكنك استخدامها مباشرة في رسالتك التالية.',
      'دعم عملي للنطق والطلاقة والصياغة الطبيعية داخل نفس المحادثة.',
      'ممارسة يومية قصيرة لمدة 10 إلى 15 دقيقة داخل Telegram، ويمكن الاستمرار عليها حتى مع جدول مزدحم.'
    ],
    howTitle: 'كيف يعمل',
    howSteps: [
      {
        title: '1. أرسل رسالة صوتية حقيقية',
        description: 'قل جملة أو جملتين عن يومك أو عملك أو خططك أو موقف حقيقي تمر به. لا تحتاج إلى نص مثالي، فقط تكلّم بشكل طبيعي على مستواك الحالي.'
      },
      {
        title: '2. احصل على تصحيح فوري وصياغة أفضل',
        description: `سترى الفكرة نفسها بصياغة أوضح وأدق وأكثر طبيعية. ويشرح لك ${teacherName} باختصار ما الذي يجب تغييره ولماذا.`
      },
      {
        title: '3. واصل الحوار وابنِ عادة يومية',
        description: 'كل رد ينتهي بسؤال أو تلميح للخطوة التالية، حتى لا تتوقف عند جملة واحدة. بهذه الطريقة تتحول الممارسة إلى عادة يومية في التحدث.'
      }
    ],
    forWhoTitle: 'لمن هذا مناسب',
    forWhoIntro: `${teacherName} مناسب للمتعلمين الذين يريدون نتائج حقيقية في التحدث باللغة ${targetLanguage}، لا مجرد دراسة نظرية صامتة.`,
    forWhoItems: [
      {
        title: 'التواصل في العمل',
        description: 'تدرّب على تحديثات الاجتماعات والمكالمات القصيرة ورسائل المتابعة والردود المهنية، حتى تبدو واضحاً وطبيعياً.'
      },
      {
        title: 'التحضير للمقابلات',
        description: 'ابنِ إجابات قصيرة وقوية للتعريف بنفسك، والخبرة، ونقاط القوة، وقصص المشاريع، والأسئلة الشائعة في المقابلات.'
      },
      {
        title: 'السفر والانتقال إلى بلد جديد',
        description: 'تدرّب على اللغة المفيدة في المطار والفندق والسكن والأوراق والمواعيد والمواقف اليومية مع الخدمات.'
      },
      {
        title: 'الحياة اليومية',
        description: 'تعلّم كيف ترد بسرعة ووضوح في مواقف مثل التسوق، والمواصلات، والطبيب، والبنك، والمحادثات العادية.'
      }
    ],
    dialoguesTitle: 'مثال على الحوار',
    dialoguesIntro: 'مثال قصير وواقعي. رسالة صوتية → رد أفضل → شرح القاعدة → خيارات للرسالة التالية.',
    deepDiveTitle: `كيف تبني طلاقة حقيقية في ${targetLanguage} عبر Telegram`,
    deepDiveParagraphs: [
      `معظم المتعلمين لا يتعثرون لأنهم يفتقرون إلى الكلمات، بل لأنهم لا يستطيعون استحضار العبارة المناسبة بسرعة في اللحظة الحقيقية. وهنا تظهر فائدة الممارسة القصيرة والمتكررة داخل Telegram. أنت تتدرّب في المكان نفسه الذي يظهر فيه الضغط الحقيقي: ردود قصيرة وعفوية وغير مُحضّرة مسبقاً.`,
      `طريقة العمل هنا واضحة: تتحدث، تحصل على تصحيح، تعيد استخدام الصياغة الأفضل، ثم تواصل. خلال 10 إلى 15 دقيقة فقط، يمكنك القيام بعدة دورات مفيدة. هذا التكرار المنتظم يقلل التردد تدريجياً ويجعل بناء الجملة أكثر سلاسة وطبيعية.`,
      `أكبر ميزة في هذا التنسيق هي انخفاض الاحتكاك. لا تحتاج إلى حجز درس، ولا إلى تنسيق مكالمة، ولا إلى فتح تطبيق جديد. عندما تجد بضع دقائق فقط، يمكنك أن تتدرّب. وهذه الاستمرارية هي ما يصنع الطلاقة الفعلية على المدى الطويل.`,
      `جودة الملاحظات مهمة جداً. لا يكفي أن يقال لك فقط: “هذا أفضل”. عندما تحصل على بدائل واضحة وشرح قصير مبني على القاعدة، تفهم ما الذي تغيّر ولماذا تغيّر. وهكذا تبدأ في ملاحظة الأنماط الطبيعية في اللغة بشكل أسرع.`,
      `هذا الأسلوب يناسب المستويات المختلفة. إذا كنت مبتدئاً، يمكنك البدء برسائل قصيرة والتركيز على تصحيح واحد في كل مرة. وإذا كنت في مستوى متوسط أو متقدم، يمكنك التدرب على إجابات أطول، وتواصل العمل، وبنية المقابلات، والتراكيب الطبيعية الأكثر دقة.`,
      `مع ${teacherName} يصبح مسار التقدم واضحاً: تحدث، احصل على التصحيح، أعد استخدام الصياغات الأفضل، وكرّر يومياً. وبعد عدة أسابيع يلاحظ المتعلمون عادة ثلاثة تغيّرات: تردد أقل، وتدفق أنظف في الجمل، وردود أسرع في المواقف الحقيقية.`
    ],
    faqTitle: 'الأسئلة الشائعة',
    faqItems: [
      {
        question: `هل هذه فعلاً ممارسة للتحدث باللغة ${targetLanguage} أم أنها تركّز أكثر على القواعد؟`,
        answer: 'التركيز الأساسي هنا على التحدث. وتظهر القواعد فقط كتصحيح عملي داخل حوار حقيقي.'
      },
      {
        question: 'كم من الوقت أحتاج كل يوم؟',
        answer: 'ابدأ بـ 10 إلى 15 دقيقة يومياً. الاستمرارية أهم من الجلسات الطويلة المتباعدة.'
      },
      {
        question: 'هل أحتاج إلى حجز دروس أو مواعيد؟',
        answer: 'لا. الممارسة بالكامل غير متزامنة داخل Telegram، لذلك يمكنك التدرب في الوقت الذي يناسبك.'
      },
      {
        question: 'هل يناسب المبتدئين أيضاً؟',
        answer: 'نعم. يمكن للمبتدئين إرسال رسائل قصيرة جداً والحصول على تصحيحات بسيطة لكنها مؤثرة.'
      },
      {
        question: 'هل أحصل أيضاً على ملاحظات حول النطق؟',
        answer: 'نعم. الملاحظات تشمل النطق والطلاقة والصياغة الطبيعية، وليس فقط تصحيح النص.'
      },
      {
        question: 'هل هو مفيد للتحضير للمقابلات؟',
        answer: 'نعم. يمكنك التدرب على التعريف بنفسك، والخبرة، ونقاط القوة، وأسئلة المتابعة مرات متكررة حتى تصبح طبيعية.'
      },
      {
        question: 'هل يمكنني التدرب على مواقف السفر أو الانتقال؟',
        answer: 'نعم. تشمل المواقف الشائعة السكن، والمواعيد، والمواصلات، والفندق، والأوراق، والخدمات اليومية.'
      },
      {
        question: 'ما الذي يجعله مختلفاً عن روبوتات الدردشة العامة؟',
        answer: 'هذا التنسيق قائم على التصحيح الموجّه: كل رد يجعلك أقوى في محاولتك التالية للتحدث، وليس مجرد دردشة عابرة.'
      },
      {
        question: 'هل يمكنني اختيار معلّم آخر لاحقاً؟',
        answer: 'نعم. يمكنك في أي وقت فتح قائمة المعلمين واختيار أسلوب مختلف.'
      },
      {
        question: 'ما أسرع طريقة لرؤية التقدم؟',
        answer: 'تحدث كل يوم، وأعد استخدام الجمل المصححة، وأجب عن كل سؤال متابعة بجمل كاملة.'
      }
    ],
    otherTeachersTitle: 'اختر معلماً آخر'
  };
}

function buildIndonesianContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'id') || getTeacherName(teacher, 'en') || 'guru';
  const targetLanguage = languageForm.display || 'Inggris';
  const base = buildEnglishContent(teacher, languageForm);

  return {
    ...base,
    metaTitle: `Latihan speaking ${targetLanguage} di Telegram | AI Language School`,
    metaDescription: `Latihan speaking ${targetLanguage} di Telegram dengan koreksi instan, phrasing yang lebih natural, dan micro-lesson harian. Mulai dalam satu menit.`,
    h1: `Latihan speaking ${targetLanguage} di Telegram`,
    heroLead: `Latih percakapan ${targetLanguage} nyata langsung di Telegram. Kirim voice message singkat, lalu ${teacherName} akan membalas dengan versi yang dikoreksi dan lebih natural untuk langsung kamu pakai.`,
    heroOutcome: `Bangun kefasihan yang praktis untuk kerja, interview, perjalanan, dan kehidupan sehari-hari dengan respons yang lebih cepat, pelafalan yang lebih jelas, dan lebih sedikit ragu.`,
    howTitle: 'Cara kerjanya',
    forWhoTitle: 'Cocok untuk siapa',
    dialoguesTitle: 'Contoh dialog',
    dialoguesIntro: 'Contoh chat singkat dan realistis. Voice message -> jawaban yang lebih baik -> penjelasan aturan -> opsi pesan berikutnya.',
    deepDiveTitle: `Cara membangun kefasihan ${targetLanguage} yang nyata lewat Telegram`,
    faqTitle: 'FAQ',
    otherTeachersTitle: 'Pilih guru lain'
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
  if (locale === 'hi') return buildHindiContent(teacher, languageForm);
  if (locale === 'ar') return buildArabicContent(teacher, languageForm);
  if (locale === 'id') return buildIndonesianContent(teacher, languageForm);
  return buildEnglishContent(teacher, languageForm);
}
