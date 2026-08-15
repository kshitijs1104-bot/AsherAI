/* ---------------------------------------------------------------------------
   Vera — privacy policy. ONE source of truth.

   The same text is rendered in two places and must never diverge between them:

     - PrivacyGate, the blocking screen a new account sees before it can reach
       any part of the product (src/pages/legal/PrivacyGate.tsx).
     - /privacy, the public page linked from the landing footer
       (src/pages/legal/PrivacyPolicyPage.tsx).

   A policy that says one thing at signup and another on the marketing site is
   worse than having none, because now there are two conflicting statements of
   what was agreed. So both surfaces render PolicyProse below, and the only
   thing that differs between them is which colour tokens they hand it.

   THIS IS A DRAFT WRITTEN AGAINST THE CODE, NOT LEGAL ADVICE. Every claim
   below was checked against what the software actually does today — the
   subprocessor list is the set of external services the server really calls,
   the retention section describes the deletion paths that really exist (and
   admits the one that does not yet). It still needs a lawyer's pass before it
   is relied on, and the four placeholders in POLICY_META need real values.

   WHEN YOU CHANGE THE MEANING OF ANYTHING HERE, bump PRIVACY_POLICY_VERSION in
   src/lib/privacyConsent.ts. That is what re-prompts everyone who accepted the
   previous wording; editing this file without bumping it silently leaves your
   users consented to a policy they never read.
--------------------------------------------------------------------------- */

// ---- FILL THESE IN BEFORE THIS SHIPS TO ANYONE OUTSIDE THE TEAM ----
//
// Left as obvious placeholders rather than plausible-looking guesses: a policy
// naming a legal entity that does not exist, or an address nobody reads, is a
// misstatement in a document whose whole value is being accurate.
export const POLICY_META = {
  /**
   * The parent company: data controller for section 1, and owner for section
   * 13. One constant for both because they are the same company — a policy
   * where the entity you agreed with and the entity that owns the software are
   * named separately invites the question of which one you are dealing with.
   *
   * PLACEHOLDER — the name is still being decided. Every mention of the parent
   * in the rendered policy reads through this one constant, so naming it is a
   * one-line change here, not a hunt through prose. Until it has a real value
   * the ownership section reads "Vera's parent company", which is true but
   * unenforceable-sounding; an IP clause that does not name the owner is the
   * one clause you do not want vague, so fill this in before launch.
   */
  parentEntity: '',
  /** Where a request under "Your choices" actually lands. Must be monitored. */
  contactEmail: 'privacy@vera.ai',
  /** Governing law / primary place of processing. */
  jurisdiction: 'India',
  /** Human-readable date shown in the header. Keep in step with the version. */
  lastUpdated: '15 August 2026',
} as const;

/** How the owner is referred to in prose until POLICY_META.parentEntity is set. */
export const OWNER_NAME = POLICY_META.parentEntity || "Vera's parent company";

/**
 * The short version, shown above the full text on both surfaces.
 *
 * Kept to six lines that each fit on two, because this block has a job the rest
 * of the document does not: it is the part that has to be READ, not merely
 * shown, so it has to fit in the consent screen's reading pane at a 720px-tall
 * window. Measured — it is within ~300px. Adding a seventh line, or letting one
 * of these run to three, pushes the last one below the fold and quietly turns
 * the summary back into something people scroll past.
 */
export const POLICY_SUMMARY: readonly string[] = [
  'Vera remembers your business, so it holds a lot about it: what you type, what you upload, whatever you connect.',
  'We use that content to run Vera for you, and to train and improve the models behind it.',
  'We may license or sell data in future. We have not yet, and we will tell you 30 days before we do.',
  'We will never sell your credentials, your tokens or your files, or anything that identifies you, without asking first.',
  'You can opt out of training, opt out of any sale, and have everything deleted — by email, any time, keeping your account.',
  'What you write and upload is yours. Vera itself — software, prompts, design — is ours, and cannot be copied.',
];

type Block = string | readonly string[];

export interface PolicySection {
  id: string;
  heading: string;
  /** A plain string is a paragraph; an array is a bulleted list. */
  body: readonly Block[];
}

export const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    id: 'scope',
    heading: '1. Who this is and what it covers',
    body: [
      `Vera is a private operating system for founders, built and operated by ${OWNER_NAME}, which is the company you are agreeing with here. This policy covers the Vera web app, the API behind it, and the marketing site. It explains what we hold about you and your company, why, who else touches it, and what you can tell us to stop doing.`,
      `Vera is sold to businesses and is not intended for anyone under 18. We do not knowingly collect data from children. If you believe a minor has an account, write to ${POLICY_META.contactEmail} and we will remove it.`,
      'Where this policy says "your data", it means both personal data about you and commercial data about your company. Both are treated the same way here, because in practice they arrive mixed together in the same sentence.',
    ],
  },
  {
    id: 'collect',
    heading: '2. What we collect',
    body: [
      'Only two of these are automatic. Everything else exists because you typed it, uploaded it, or connected it.',
      [
        'Account and identity — your name, email address and sign-in metadata. Handled by our authentication provider (see section 5); we hold the resulting user id and email, never your password.',
        'Business profile — company name, stage, industry, team size, country, revenue figure and primary goal, from the onboarding steps and from Settings. This is attached to every request Vera makes on your behalf.',
        'What you say to Vera — the full text of your messages and Vera\'s replies, stored server-side as a permanent log so that threads, decisions and goals stay linked to each other over months.',
        'What Vera derives from you — facts about your company, decisions, goals, roadmap items, learnings, monthly reviews and confidence scores. This is the memory layer; it is the product.',
        'Files you upload — images and documents you attach in the composer. The file itself is stored on our server, and its text or visual content is extracted so Vera can read it.',
        'Connected accounts — if, and only if, you connect one: Gmail, Google Calendar, Google Sheets, Notion, Jira, Slack, LinkedIn or WhatsApp. We hold an encrypted access token plus the specific content the connector is scoped to read. Disconnecting revokes the token.',
        'Technical and usage data — IP address, browser and device information, request logs, timestamps and error traces. Kept to run the service, rate-limit abuse and debug failures.',
      ],
      'We do not ask for and do not want: payment card numbers (our payment provider handles those and we never see the full number), government identifiers, health data, or your customers\' personal data. Please do not paste any of those into a chat.',
    ],
  },
  {
    id: 'use',
    heading: '3. What we use it for',
    body: [
      [
        'Running Vera — answering you, remembering context between sessions, building your dossier, tracking goals and decisions, and assembling the monthly review.',
        'Making Vera better — measuring where it was wrong, unclear, ungrounded or too slow, and fixing that. This includes training, described separately below because it deserves to be.',
        'Keeping it safe and working — abuse prevention, rate limiting, security investigation, backups and debugging.',
        'Talking to you — service notices, and product email you can unsubscribe from.',
        'Legal obligations — responding to lawful requests, and defending or establishing legal claims.',
      ],
      'We do not run advertising, and we do not build advertising profiles of you.',
    ],
  },
  {
    id: 'training',
    heading: '4. Training and improving the model',
    body: [
      'This is the part most policies bury, so: we use your content to train, tune and evaluate the models, prompts and retrieval behind Vera. That includes your messages, Vera\'s replies, the facts and decisions Vera derived from them, the content of files you uploaded, and any feedback you gave on a response.',
      'How we limit it:',
      [
        'We aggregate and strip identifiers wherever the work does not require them — which is most of the time, because what we are usually trying to learn is a pattern, not a company.',
        'Training data is held under the same access controls as production data. It is not a looser copy in a spreadsheet somewhere.',
        'We do not publish your content, and we do not use it in marketing, case studies or demos without asking you in writing first.',
        'Your credentials and connected-account tokens are never training input. They are secrets, not text.',
      ],
      `You can opt out of training at any time by emailing ${POLICY_META.contactEmail}. Vera keeps working exactly as before — opting out costs you no feature, and we will not ask you to justify it.`,
      'One honest limit: where your content has already been incorporated into a trained model or an aggregated dataset, we cannot always extract it again afterwards. What an opt-out or a deletion request guarantees is that we stop using your data from that point forward, and that it is excluded from everything we train after it.',
    ],
  },
  {
    id: 'sharing',
    heading: '5. Who else touches your data',
    body: [
      'Vera runs on other companies\' infrastructure. These are the ones that see your data today, and what each one gets:',
      [
        'Our authentication provider (Clerk) — your name, email and session data. It is how sign-in works.',
        'Our model provider (Groq) — the contents of the request Vera is answering: your question plus the context Vera assembled for it. This is how an answer gets generated. We send the minimum the answer needs and no more, and their handling of it is governed by their own terms, which we review.',
        'Our hosting and database providers — everything, at rest, because that is where the application and the Postgres database physically live.',
        'Web search and page retrieval (DuckDuckGo, Jina Reader) — when a question needs current outside information, the search terms Vera constructs are sent out. Your identity is not attached to them.',
        'Providers you connect yourself (Google, Notion, Atlassian, Slack, Meta) — only the account you connected, only the scopes you granted, only while it stays connected.',
        'Professional advisers, and an acquirer if the company is ever sold or reorganised — in which case this policy travels with the data, and we will tell you before anything changes.',
        'Law enforcement or a court — only where we are legally required, and we will notify you unless we are prohibited from doing so.',
      ],
      'Each of these is a processor acting on our instructions, not a party free to do as it likes with your data. None of them is paying us for access.',
    ],
  },
  {
    id: 'sale',
    heading: '6. Selling and licensing data',
    body: [
      'We may, in future, sell or license data derived from use of Vera to third parties — for example aggregated benchmarks about how companies at a given stage actually operate. We are telling you this now rather than adding it quietly later.',
      'What is true as of the date on this policy: no such sale or licence has happened, and no such arrangement is in place. We also do not yet know who those third parties would be, so we cannot honestly name them here. When we do, we will name them.',
      'The limits below are commitments, not intentions. They bind any such arrangement:',
      [
        'We will give you at least 30 days\' notice, by email, before any sale or licensing of data begins.',
        'Nothing that identifies you, your company, your staff or your customers will be sold without your separate, explicit consent. Default is aggregated and de-identified.',
        'Your credentials, access tokens, uploaded files and raw message contents are never for sale, under any arrangement, at any price.',
        'Any buyer is contractually bound to the same limits and may not resell onward without them.',
        'Data will not be sold to people-search or background-check brokers, nor for use in targeting, harassment, discrimination, or anything intended to damage you or your company.',
        `You can opt out of any sale of your data permanently, at any time, by emailing ${POLICY_META.contactEmail}. Opting out does not change your price or your access. If you are in a jurisdiction that gives you a statutory right to opt out of sale — California and several other US states do — this is that mechanism.`,
      ],
    ],
  },
  {
    id: 'retention',
    heading: '7. How long we keep it, and how to get rid of it',
    body: [
      'While your account is open, we keep your business context, message log, derived memory and uploads, because Vera\'s usefulness is a direct function of how much of your history it still has.',
      [
        'Delete a chat in the app and the chat and its goals are removed immediately.',
        `Uploaded files and the permanent message log are not yet deletable from inside the app — that is being built. Until it exists, email ${POLICY_META.contactEmail} and we will delete them for you within 30 days.`,
        'Disconnect a connector and its access token is revoked and deleted.',
        'Close your account, or ask us to, and we delete your personal data and company data within 30 days, except where law requires us to keep something specific.',
        'Backups roll off within 90 days, so a deleted item can persist in a backup for up to that long before it is gone everywhere.',
        'Technical logs are kept for a short operational window and then discarded.',
      ],
      'The limit described at the end of section 4 applies to deletion too: already-trained models and already-aggregated datasets cannot always be unwound.',
    ],
  },
  {
    id: 'security',
    heading: '8. Security',
    body: [
      [
        'Traffic is encrypted in transit (TLS). The database is encrypted at rest by our provider.',
        'Connected-account OAuth tokens are encrypted with AES-256-GCM before storage, separately from everything else.',
        'Every data request is authenticated against a verified session and scoped to your user id on the server, not merely in the interface.',
        'Uploads are stored under server-generated filenames, never a path derived from what you typed.',
        'Internal access to production data is limited to people who need it to operate or debug the service.',
      ],
      'No system is perfectly secure, and we will not pretend otherwise. If a breach affects your data we will tell you and the relevant regulator without undue delay, within 72 hours of becoming aware where that applies to us, and we will tell you what we know rather than what sounds best.',
    ],
  },
  {
    id: 'rights',
    heading: '9. Your choices',
    body: [
      `One address for all of it: ${POLICY_META.contactEmail}. We answer within 30 days and will not make you use a form.`,
      [
        'Get a copy of what we hold about you, in a portable format.',
        'Correct anything that is wrong.',
        'Delete your data, or your whole account.',
        'Opt out of training (section 4).',
        'Opt out of any sale or licensing of your data (section 6).',
        'Object to or restrict a particular use, and withdraw a consent you gave earlier.',
        'Complain to your local data protection authority. You do not have to come to us first, though we would rather you did.',
      ],
      `Depending on where you live, some of these are statutory rights — under the GDPR in the UK and EEA, the DPDP Act in India, and state privacy laws in the US. We apply them to everyone regardless of where they live, because operating two standards is how the lower one becomes the real one.`,
    ],
  },
  {
    id: 'transfers',
    heading: '10. Where your data goes',
    body: [
      `We are based in ${POLICY_META.jurisdiction}, and the providers in section 5 operate in the United States and the European Union. Using Vera means your data crosses borders. Where it leaves a jurisdiction with transfer restrictions, we rely on the standard contractual protections our providers offer.`,
    ],
  },
  {
    id: 'changes',
    heading: '11. Changes to this policy',
    body: [
      'This policy is versioned. If we change what we actually do with your data, we will bump the version, email you, and ask you to read and accept the new wording the next time you open Vera. Small clarifications that do not change meaning we will simply date.',
      'We will not use a silent edit to acquire a permission you did not give.',
    ],
  },
  {
    id: 'contact',
    heading: '12. Contact',
    body: [
      `Questions, requests, or something in here that turns out to be wrong: ${POLICY_META.contactEmail}. If you tell us this policy does not match what the product does, we will treat it as a bug in the product or a bug in the policy, and fix whichever one is broken.`,
    ],
  },
];

/* ---------------------------------------------------------------- ownership */

/**
 * Ownership and IP. Strictly speaking this is terms-of-use material, not
 * privacy material, and it will eventually want its own document — but it is
 * shown on the same first-run screen and rendered under its own labelled
 * heading, for one reason: the first-run screen is the only moment where you
 * can be certain a person saw something before they used the product. An IP
 * clause nobody was shown is an IP clause that is hard to enforce.
 *
 * Kept separate from POLICY_SECTIONS rather than appended to it so the split
 * stays visible in code, and so pulling this into a real /terms document later
 * is a move rather than a surgery.
 */
export const OWNERSHIP_SECTIONS: readonly PolicySection[] = [
  {
    id: 'ownership',
    heading: '13. Vera is our property',
    body: [
      `Vera — the name, the mark, the software, the interface, the prompts and system instructions, the memory and dossier architecture, the model configuration, the documentation, and every part of how it works — is owned by ${OWNER_NAME} and protected by copyright, trademark, database and trade-secret law. Nothing in this document transfers any of it to you.`,
      'What you get instead is a licence: a limited, non-exclusive, non-transferable, revocable right to use Vera as a customer, for your own business, for as long as your account is in good standing. That is the whole of the grant.',
      'Without our written permission, you may not:',
      [
        'copy, reproduce, republish, mirror or redistribute any part of Vera, including its interface, its copy, or its outputs presented as a product of your own;',
        'reverse-engineer, decompile or otherwise attempt to derive our prompts, system instructions or internal logic;',
        'scrape, crawl or bulk-extract from Vera by any automated means, or access it other than through the interfaces we provide;',
        'resell, sublicense, rent, white-label or otherwise make Vera available to anyone outside your company;',
        'use Vera, or its outputs, to build, train or evaluate a competing product or a model intended to replicate it;',
        'remove or obscure any proprietary notice, or use our name, logo or brand without permission — this policy licenses no trademark to anyone.',
      ],
      `We enforce this. Breach ends the licence immediately and we reserve every remedy available to us, including injunctive relief and recovery of costs. If you have found someone copying Vera, tell us at ${POLICY_META.contactEmail}.`,
    ],
  },
  {
    id: 'your-content',
    heading: '14. Your content stays yours',
    body: [
      'The reciprocal half, and it matters as much: your business data, your files and what you write to Vera remain yours. We claim no ownership of them.',
      `What you grant us is a licence to process that content for the purposes set out in this policy — running Vera for you, and improving it, including training as described in section 4, which you can opt out of. Nothing more. If you close your account, that licence ends with it, subject to the deletion terms in section 7.`,
      'What Vera writes back to you — analyses, drafts, reviews, recommendations — is yours to use in your business freely, including commercially. We ask only that you do not present Vera itself as your own product, which is the line drawn in section 13.',
    ],
  },
  {
    id: 'no-advice',
    heading: '15. Vera is not your lawyer, accountant or doctor',
    body: [
      'Vera produces analysis and recommendations, generated by a model, from the information available to it. It can be confidently wrong. It is not legal, financial, tax, medical or professional advice, and it is not a substitute for someone qualified and accountable.',
      'Decisions you make remain yours. Check anything consequential — particularly anything with a number, a legal consequence, or someone\'s wellbeing attached to it — against a qualified human before you act on it.',
    ],
  },
];

/* ------------------------------------------------------------------- render */

/**
 * The two palettes this text gets rendered against. `app` is the product's
 * token set (used inside the consent gate, which sits in the app shell);
 * `landing` is the marketing page's self-contained --lp-* set, which
 * deliberately shares nothing with the app. See the header of landing.css.
 */
const TONE = {
  app: {
    heading: 'var(--text)',
    body: 'var(--muted)',
    strong: 'var(--text)',
    rule: 'var(--border)',
    marker: 'var(--mint)',
  },
  landing: {
    heading: 'var(--lp-text)',
    body: 'var(--lp-text-2)',
    strong: 'var(--lp-text)',
    rule: 'var(--lp-line)',
    marker: 'var(--lp-teal)',
  },
} as const;

export type PolicyTone = keyof typeof TONE;

/** The plain-terms summary block. Rendered above the sections on both surfaces. */
export function PolicySummary({ tone = 'app' }: { tone?: PolicyTone }) {
  const c = TONE[tone];

  return (
    <div
      style={{
        border: `1px solid ${c.rule}`,
        borderRadius: 12,
        padding: '18px 20px',
        display: 'grid',
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: c.marker,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        In plain terms
      </div>
      <ul style={{ display: 'grid', gap: 8, margin: 0, paddingLeft: 18 }}>
        {POLICY_SUMMARY.map((line) => (
          <li key={line} style={{ fontSize: 13.5, lineHeight: 1.6, color: c.body }}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The policy body. Defaults to the privacy sections; pass OWNERSHIP_SECTIONS to
 * render the ownership block, which both surfaces do under its own heading.
 */
export function PolicyProse({
  tone = 'app',
  sections = POLICY_SECTIONS,
}: {
  tone?: PolicyTone;
  sections?: readonly PolicySection[];
}) {
  const c = TONE[tone];

  return (
    <div style={{ display: 'grid', gap: 26 }}>
      {sections.map((section) => (
        <section key={section.id} id={section.id} style={{ display: 'grid', gap: 10 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 650,
              letterSpacing: '-0.01em',
              color: c.heading,
            }}
          >
            {section.heading}
          </h3>
          {section.body.map((block, i) =>
            typeof block === 'string' ? (
              <p key={i} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: c.body }}>
                {block}
              </p>
            ) : (
              <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 7 }}>
                {block.map((item) => (
                  <li key={item} style={{ fontSize: 13.5, lineHeight: 1.65, color: c.body }}>
                    {item}
                  </li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </div>
  );
}
