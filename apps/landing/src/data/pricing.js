const PRO_MONTHLY_PRICE = 10;
const PRO_ANNUAL_PRICE = 60;
const MONTHS_IN_YEAR = 12;

const annualMonthlyEquivalent = Number((PRO_ANNUAL_PRICE / MONTHS_IN_YEAR).toFixed(2));
const annualSavingsPercent = Math.round((1 - PRO_ANNUAL_PRICE / (PRO_MONTHLY_PRICE * MONTHS_IN_YEAR)) * 100);

export const pricingTiers = [
  {
    id: 'free',
    plan: 'free',
    price: 0,
    billingInterval: 'month',
    highlight: false
  },
  {
    id: 'pro-month',
    plan: 'pro',
    price: PRO_MONTHLY_PRICE,
    billingInterval: 'month',
    highlight: false
  },
  {
    id: 'pro-year',
    plan: 'pro',
    price: PRO_ANNUAL_PRICE,
    billingInterval: 'year',
    highlight: true,
    monthlyEquivalent: annualMonthlyEquivalent,
    savingsPercent: annualSavingsPercent
  }
];
