# Proof

This folder holds the photos for the Proof section on the S-Core Tech page.

The section does not exist on the live site until you put something in it.
That is deliberate: a testimonials block with nothing real in it is worse
than no testimonials block at all, and every visitor can tell.

## Adding a job

Open `../app.js`. The first thing in the file, under the WhatsApp number, is
`PROOF_JOBS`. Uncomment the example and fill it in:

```js
const PROOF_JOBS = [
  {
    title: 'MacBook Pro 2017 — dead, no charge light',
    note:  'Liquid damage across the board. Cleaned, two power rails rebuilt, '
         + 'back with the owner the next evening.',
    before: 'proof/macbook-before.jpg',   // optional
    after:  'proof/macbook-after.jpg',    // optional
    price:  '₹3,200',                     // optional
  },
];
```

`title` is the only field you must have. A job with no photos still earns its
place — "dead, no charge light → working, ₹3,200, next day" is proof.

## Adding what someone said

Same file, `PROOF_WORDS`:

```js
const PROOF_WORDS = [
  { text: 'Took it to two shops before this. Fixed in a day and the price did not move.',
    who: 'Rashid', where: 'Manjeri' },
];
```

**Ask before you publish anyone's words or name.** A screenshot of a WhatsApp
message is not permission. "Can I put this on my site, with your first name
and your town?" takes ten seconds and is the difference between a testimonial
and a problem.

## The photos

- Put them in this folder and reference them as `proof/your-file.jpg`.
- They are shown at 4:3 and cropped to fill, so centre the device.
- Keep each under about 300 KB. A phone photo is 3–5 MB; resize it to about
  1200px wide first or the page will crawl on mobile data.
- Do not photograph anything identifying: lock screens, contacts, photos,
  stickers with names, the repair tag with a phone number. The board, the
  chassis and the screen are the story.

## What makes a good pair

The temptation is a dramatic "before". The convincing one is the **after** —
a clean board, a screen showing the desktop, a battery reading 100%. People
believe the finish, not the mess.

Three jobs is enough to start. Ten is better than thirty.
