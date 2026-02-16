import { normalizeLocale } from '../i18n.js';
import { normalizeLanguageCodeForSlugs } from './slugTokens.js';
import { getTeacherName } from './teachers.js';

const LANGUAGE_FORMS = {
  en: {
    en: { display: 'English', adjective: 'English' },
    de: { display: 'German', adjective: 'German' },
    it: { display: 'Italian', adjective: 'Italian' },
    uk: { display: 'Ukrainian', adjective: 'Ukrainian' }
  },
  uk: {
    en: { display: 'англійська', genitive: 'англійської' },
    de: { display: 'німецька', genitive: 'німецької' },
    it: { display: 'італійська', genitive: 'італійської' },
    uk: { display: 'українська', genitive: 'української' }
  },
  it: {
    en: { display: 'inglese' },
    de: { display: 'tedesco' },
    it: { display: 'italiano' },
    uk: { display: 'ucraino' }
  }
};

const DIALOGUE_PHRASES = {
  en: {
    atm: 'I need to withdraw cash, and I am not sure about the fee.',
    doctor: 'I have had a sore throat for two days and a mild fever.',
    rent: 'I would like to rent this flat from next month, if it is still available.'
  },
  de: {
    atm: 'Ich muss Bargeld abheben und bin mir bei der Gebühr nicht sicher.',
    doctor: 'Ich habe seit zwei Tagen Halsschmerzen und leichtes Fieber.',
    rent: 'Ich möchte diese Wohnung ab nächstem Monat mieten, falls sie noch frei ist.'
  },
  it: {
    atm: 'Devo prelevare contanti e non sono sicuro della commissione.',
    doctor: 'Ho mal di gola da due giorni e una leggera febbre.',
    rent: 'Vorrei affittare questo appartamento dal mese prossimo, se è ancora disponibile.'
  },
  uk: {
    atm: 'Мені потрібно зняти готівку, але я не впевнений щодо комісії.',
    doctor: 'У мене вже два дні болить горло і є невелика температура.',
    rent: 'Я хотів би орендувати цю квартиру з наступного місяця, якщо вона ще доступна.'
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

function getDialoguePhrase(languageCodeInput, scenario) {
  const code = normalizeLanguageCodeForSlugs(languageCodeInput) || 'en';
  const map = DIALOGUE_PHRASES[code] || DIALOGUE_PHRASES.en;
  return map[scenario] || DIALOGUE_PHRASES.en[scenario] || '';
}

function buildEnglishContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'en') || 'Teacher';
  const targetLanguage = languageForm.display || languageForm.adjective || 'English';

  return {
    metaTitle: `${targetLanguage} speaking practice in Telegram with ${teacherName} | AI Language School`,
    metaDescription: `Practice spoken ${targetLanguage} in Telegram with instant corrections, natural phrasing, and daily micro-lessons. Learn with ${teacherName} and start in one minute.`,
    h1: `${targetLanguage} speaking practice in Telegram with ${teacherName}`,
    heroLead: `AI Language School gives you structured, voice-first speaking practice directly inside Telegram. You send a short voice message, ${teacherName} replies in ${targetLanguage}, and you immediately see where to improve.`,
    heroOutcome: `The goal is practical fluency: clearer sentences, faster responses, and more confidence in real situations such as travel, work calls, interviews, doctor visits, and renting a flat abroad.`,
    coreBullets: [
      'Instant correction with clear alternatives you can reuse in the next message.',
      'Pronunciation, fluency, and natural phrasing support in a daily chat format.',
      'Micro-practice that fits your schedule: consistent progress in 10–15 minutes.'
    ],
    secondaryCta: 'See all teachers',
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
    dialoguesTitle: 'Dialogue examples',
    dialoguesIntro: `These are the conversation types learners ask for most often. Each scenario teaches practical wording plus confidence under time pressure.`,
    dialogueExamples: [
      {
        scenario: 'ATM and banking',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'atm'),
        teacherLine: `Great start. Let’s make it smoother and add one precise question for the bank employee.`,
        note: 'Focus: polite requests, fee clarification, and quick follow-up questions.'
      },
      {
        scenario: 'Doctor appointment',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'doctor'),
        teacherLine: 'Excellent. Now we add symptom duration, severity, and one direct request for next steps.',
        note: 'Focus: symptom timeline, clear medical vocabulary, and concise structure.'
      },
      {
        scenario: 'Apartment rent',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'rent'),
        teacherLine: `Nice. Let’s make it negotiation-ready with payment timing, contract terms, and one clarity question.`,
        note: 'Focus: negotiation language, contract wording, and practical confirmation phrases.'
      }
    ],
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

  return {
    metaTitle: `Практика розмовної ${targetGenitive} в Telegram з ${teacherName} — AI викладач | AI Language School`,
    metaDescription: `Практикуй розмовну ${targetGenitive} щодня: надсилай голосові в Telegram, отримуй миттєві виправлення, природні фрази та чіткий фідбек. Почни за 1 хвилину з ${teacherName}.`,
    h1: `Практика розмовної ${targetGenitive} в Telegram з ${teacherName}`,
    heroLead: `Це сторінка для тих, хто хоче не просто “вчити правила”, а реально говорити ${targetDisplay} в живих ситуаціях. Ти надсилаєш голосове повідомлення, а ${teacherName} одразу повертає виправлену та природнішу версію.`,
    heroOutcome: `Результат — менше пауз, краща вимова, впевненіші відповіді та відчутний прогрес у щоденному speaking practice: робота, співбесіда, переїзд, подорожі та побутові діалоги.`,
    coreBullets: [
      'Миттєві виправлення: помилки, кращі фрази, чітка логіка, чому саме так.',
      'Фокус на вимові, плавності та природному формулюванні думки в діалозі.',
      'Щоденна мікропрактика в Telegram, яку реально підтримувати навіть у щільному графіку.'
    ],
    secondaryCta: 'Подивитися всіх викладачів',
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
    dialoguesTitle: 'Приклади діалогів',
    dialoguesIntro: 'Найчастіші сценарії, які учні просять відпрацювати: банк/ATM, лікар і оренда житла. Саме ці теми дають швидкий практичний ефект.',
    dialogueExamples: [
      {
        scenario: 'ATM / банк',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'atm'),
        teacherLine: 'Добре. Додаємо ввічливий запит і коротке уточнення, щоб ти звучав упевнено та конкретно.',
        note: 'Фокус: ввічливі запити, уточнення комісії, зрозуміле завершення розмови.'
      },
      {
        scenario: 'Лікар',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'doctor'),
        teacherLine: 'Супер старт. Тепер структуруємо симптоми, тривалість і чітке питання про наступний крок.',
        note: 'Фокус: симптоми, часові маркери, точні формулювання без зайвих пауз.'
      },
      {
        scenario: 'Оренда квартири',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'rent'),
        teacherLine: 'Чудово. Додаємо мову переговорів: умови, дата в’їзду, оплата і перевірка деталей договору.',
        note: 'Фокус: переговорні фрази, контрактна лексика, контроль уточнень.'
      }
    ],
    deepDiveTitle: `Як реально прокачати розмовну ${targetGenitive} через Telegram`,
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

function buildItalianContent(teacher, languageForm) {
  const teacherName = getTeacherName(teacher, 'it') || getTeacherName(teacher, 'en') || 'insegnante';
  const targetLanguage = languageForm.display || 'inglese';

  return {
    metaTitle: `Pratica di conversazione in ${targetLanguage} su Telegram con ${teacherName} | AI Language School`,
    metaDescription: `Allena il parlato in ${targetLanguage} ogni giorno su Telegram: messaggi vocali, correzioni immediate, frasi naturali e feedback pratico. Inizia in un minuto con ${teacherName}.`,
    h1: `Pratica di conversazione in ${targetLanguage} su Telegram con ${teacherName}`,
    heroLead: `Questa pagina è pensata per chi vuole parlare davvero ${targetLanguage}, non solo studiare teoria. Invi un vocale, ${teacherName} risponde subito con la versione corretta e più naturale.`,
    heroOutcome: `L'obiettivo è concreto: meno blocchi, più fluidità, pronuncia più chiara e frasi utili per lavoro, colloqui, trasferimento, viaggi e situazioni quotidiane.`,
    coreBullets: [
      'Correzione immediata con alternative pronte da riutilizzare nella risposta successiva.',
      'Supporto su pronuncia, scorrevolezza e naturalezza della frase.',
      'Micro-pratica quotidiana in Telegram, sostenibile anche con agenda piena.'
    ],
    secondaryCta: 'Vedi tutti gli insegnanti',
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
    dialoguesTitle: 'Esempi di dialogo',
    dialoguesIntro: 'Scenari concreti che danno impatto rapido: ATM/banca, medico e affitto. Qui il lessico pratico fa la differenza.',
    dialogueExamples: [
      {
        scenario: 'ATM / banca',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'atm'),
        teacherLine: 'Ottimo inizio. Rendiamolo più naturale con una richiesta educata e una domanda di chiarimento.',
        note: 'Focus: richieste cortesi, commissioni, conferma rapida.'
      },
      {
        scenario: 'Visita medica',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'doctor'),
        teacherLine: 'Perfetto. Ora aggiungiamo durata, intensità e una domanda diretta sul prossimo passo.',
        note: 'Focus: sintomi, tempo, precisione lessicale.'
      },
      {
        scenario: 'Affitto appartamento',
        learnerLine: getDialoguePhrase(teacher.learningLanguage, 'rent'),
        teacherLine: 'Molto bene. Passiamo a una versione da trattativa con termini chiari su condizioni e pagamento.',
        note: 'Focus: negoziazione, termini contrattuali, verifiche finali.'
      }
    ],
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

export function getTeacherSeoContent(teacher, localeInput) {
  const locale = normalizeLocale(localeInput) || 'en';
  const languageForm = getLanguageForm(locale, teacher?.learningLanguage);

  if (locale === 'uk') return buildUkrainianContent(teacher, languageForm);
  if (locale === 'it') return buildItalianContent(teacher, languageForm);
  return buildEnglishContent(teacher, languageForm);
}
