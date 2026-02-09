export const teachers = [
  {
    slug: 'lesia',
    name: 'Lesia',
    tagline: 'Gentle corrections',
    languages: ['Ukrainian', 'English'],
    focus: 'Daily speaking habit',
    bio: 'Friendly, clear corrections with a focus on natural phrasing and confidence.',
    photoUrl: '/teachers/lesia.svg',
    telegramUrl: ''
  },
  {
    slug: 'gabe',
    name: 'Gabe',
    tagline: 'Fast feedback',
    languages: ['English'],
    focus: 'Business English',
    bio: 'Short, direct corrections and better ways to say what you mean in professional settings.',
    photoUrl: '/teachers/gabe.svg',
    telegramUrl: ''
  },
  {
    slug: 'mira',
    name: 'Mira',
    tagline: 'Patient practice',
    languages: ['English'],
    focus: 'Travel + everyday speech',
    bio: 'Build speaking comfort with practical scenarios and gentle pacing.',
    photoUrl: '/teachers/mira.svg',
    telegramUrl: ''
  },
  {
    slug: 'alex',
    name: 'Alex',
    tagline: 'Structured drills',
    languages: ['German', 'English'],
    focus: 'Grammar + clarity',
    bio: 'Step-by-step explanations and targeted drills to remove recurring mistakes.',
    photoUrl: '/teachers/alex.svg',
    telegramUrl: ''
  }
];

export function getTeacherBySlug(slug) {
  const key = (slug || '').toString().trim().toLowerCase();
  return teachers.find((t) => t.slug === key) || null;
}
