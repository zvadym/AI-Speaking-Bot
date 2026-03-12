import { Router } from 'express';

export function createStripeWebhookRouter(ctx, helpers) {
  const router = Router();

  router.post('/', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).send('Missing stripe-signature');
    }

    let event;
    try {
      event = ctx.stripe.webhooks.constructEvent(req.body, sig, ctx.env.stripeWebhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      await helpers.handleStripeEvent(event);
      return res.json({ received: true });
    } catch (err) {
      console.error('Stripe webhook handler failed', err);
      return res.status(500).json({ error: 'webhook_failed' });
    }
  });

  return router;
}
