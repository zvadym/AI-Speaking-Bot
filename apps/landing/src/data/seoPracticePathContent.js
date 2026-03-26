export function getPracticePathSeoContent(practicePath, locale, t) {
  if (!practicePath) return null;

  const baseLanguage = t(`languageName.${practicePath.baseLanguage}`);
  const targetLanguage = t(`languageName.${practicePath.targetLanguage}`);
  const title = `${baseLanguage} → ${targetLanguage}`;

  return {
    title,
    metaTitle: `${title} with Romi | Speak in Telegram`,
    metaDescription: `Practice ${targetLanguage} from ${baseLanguage} with Romi in Telegram. Short daily conversation, corrections, and calm step-by-step speaking practice.`,
    heroLead: `Practice ${targetLanguage} from ${baseLanguage} with one friendly speaking companion in Telegram.`,
    heroOutcome: 'Short daily conversation, clear corrections, and steady confidence building.',
    coreBullets: [
      'Short speaking reps you can fit into a normal day.',
      'Corrections that stay simple, clear, and usable.',
      'A calm chat flow that helps you keep going.'
    ],
    howTitle: 'How this path works',
    howSteps: [
      {
        title: `Start your ${title} path`,
        description: `Open ${title} in Telegram and begin with a short voice or text message.`
      },
      {
        title: 'Practice one real situation at a time',
        description: 'Use short daily exchanges to build speaking rhythm instead of waiting for long study sessions.'
      },
      {
        title: 'Reuse better phrasing immediately',
        description: 'Take the corrected version and send the next reply right away while the context is still fresh.'
      }
    ],
    forWhoTitle: 'Who this path is for',
    forWhoIntro: `This path works well if you want regular ${targetLanguage} speaking practice without scheduling live sessions.`,
    forWhoItems: [
      {
        title: 'Daily practice',
        description: 'For learners who want a simple habit and consistent momentum.'
      },
      {
        title: 'Real conversation',
        description: 'For learners who want useful, natural phrasing instead of isolated exercises.'
      },
      {
        title: 'Low-pressure speaking',
        description: 'For learners who prefer a calmer way to speak more often.'
      }
    ],
    dialoguesTitle: 'See the practice flow',
    dialoguesIntro: `A typical ${title} session starts with one short message and grows naturally from there.`,
    deepDiveTitle: `Why ${title} works`,
    deepDiveParagraphs: [
      `You do not need a perfect plan to improve your ${targetLanguage}. You need frequent reps in a format you can return to easily.`,
      `This ${title} path keeps the work focused: say something real, get a better version, and keep the conversation moving.`,
      'That loop is simple enough to repeat and useful enough to compound over time.'
    ],
    faqTitle: `FAQ for ${title}`,
    faqItems: [
      {
        question: `How do I practice ${targetLanguage} from ${baseLanguage} with Romi?`,
        answer: `Open the ${title} path in Telegram, send a short voice or text message, and Romi replies with corrections and a natural next step.`
      },
      {
        question: 'Do I need to book lessons?',
        answer: 'No. This path is asynchronous, so you can practice whenever you have a few free minutes.'
      },
      {
        question: 'Can I use voice and text?',
        answer: 'Yes. You can switch between voice and text depending on what feels easier in the moment.'
      }
    ],
    relatedTitle: 'More practice paths'
  };
}
