/* ---------------------------------------------------------------------------
   Vera — privacy policy and terms. ONE source of truth.

   The same text is rendered in two places and must never diverge between them:

     - PrivacyGate, the blocking screen a new account sees before it can reach
       any part of the product (src/pages/legal/PrivacyGate.tsx).
     - /privacy, the public page linked from the landing footer
       (src/pages/legal/PrivacyPolicyPage.tsx).

   A policy that says one thing at signup and another on the marketing site is
   worse than having none, because now there are two conflicting statements of
   what was agreed. So both surfaces render PolicyProse below, and the only
   thing that differs between them is which colour tokens they hand it.

   THIS IS A DRAFT WRITTEN AGAINST THE CODE, NOT LEGAL ADVICE. Every factual
   claim was checked against what the software actually does: the subprocessor
   list is the set of external services the server really calls, and the
   deletion section describes the cascade that api-server/src/lib/
   dataDeletion.ts really performs. The liability and IP sections are drafted to
   be as protective as honest drafting allows, which is not the same as being
   unchallengeable — see the note above section 17. It needs a lawyer's pass
   before it is relied on, and POLICY_META needs real values.

   WHEN YOU CHANGE THE MEANING OF ANYTHING HERE, bump PRIVACY_POLICY_VERSION in
   src/lib/privacyConsent.ts. That is what re-prompts everyone who accepted the
   previous wording; editing this file without bumping it silently leaves your
   users consented to a policy they never read.
--------------------------------------------------------------------------- */

export const POLICY_META = {
  /**
   * The parent company: data controller for section 1, and owner for section
   * 14. One constant for both because they are the same company — a policy
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
  contactEmail: 'kshitij.s1104@gmail.com',
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
 * window. Measured — it is within ~320px. Adding a seventh line, or letting one
 * of these run to three, pushes the last one below the fold and quietly turns
 * the summary back into something people scroll past.
 */
export const POLICY_SUMMARY: readonly string[] = [
  // Lines 1, 3 and 6 are kept under ~70 characters so they set on ONE line at
  // the consent screen's width. That is not stylistic: at two lines each the
  // block ran 44px past the reading pane and pushed the last point below the
  // fold. Lines 2, 4 and 5 are allowed to run to two because they carry the
  // three things someone would later claim they were never told.
  'Vera remembers your business: what you type, upload, and connect.',
  'Vera stores that content and trains on it. That is how it becomes a better consultant for you, and it is not optional.',
  'We never sell your data. It is encrypted and used only to run Vera.',
  'Delete a chat and its messages, files and derived notes are gone. Close your account and everything is gone.',
  'Vera can be confidently wrong. Acting on what it tells you is your risk and your decision, not a guarantee from us.',
  "What you write is yours. Vera's software, prompts and design are ours.",
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
      'Vera is a product for businesses, and we ask for a work email address when you sign up. We do not direct Vera at children, we do not market it to them, and we do not knowingly collect personal data from a child. If you believe a child has given us data, write to us at the address in section 13 and we will delete it.',
      'Where this policy says "your data", it means both personal data about you and commercial data about your company. Both are treated the same way here, because in practice they arrive mixed together in the same sentence.',
      'Sections 1 to 13 are the privacy policy. Sections 14 to 18 are the terms on which Vera is provided — ownership, the limits of what Vera can promise you, and the limits of what we are liable for. Using Vera means agreeing to all of it.',
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
        'What you say to Vera — the full text of your messages and Vera\'s replies, stored server-side as a durable log so that threads, decisions and goals stay linked to each other over months.',
        'What Vera derives from you — facts about your company, decisions, goals, roadmap items, learnings, monthly reviews and confidence scores. This is the memory layer; it is the product.',
        'Files you upload — images and documents you attach in the composer. The file is stored on our server, and its text or visual content is extracted once so Vera can read it without re-reading the file on every question.',
        'Connected accounts — if, and only if, you connect one: Gmail, Google Calendar, Google Sheets, Notion, Jira, Slack, LinkedIn or WhatsApp. We hold an encrypted access token plus the specific content the connector is scoped to read. Disconnecting deletes our copy of the token.',
        'Technical and usage data — IP address, browser and device information, request logs, timestamps and error traces. Kept to run the service, rate-limit abuse and debug failures.',
      ],
      'We do not ask for and do not want: payment card numbers (our payment provider handles those and we never see the full number), government identifiers, health data, biometric data, or your own customers\' personal data. Please do not paste any of those into a chat. If you do, you are responsible for having the right to share it, and section 18 applies.',
    ],
  },
  {
    id: 'use',
    heading: '3. What we use it for',
    body: [
      [
        'Running Vera — answering you, remembering context between sessions, building your dossier, tracking goals and decisions, and assembling the monthly review.',
        'Making Vera better at advising you — storing and training on your content, described in full in section 4 because it is the mechanism the whole product rests on.',
        'Keeping it safe and working — abuse prevention, rate limiting, security investigation, backups and debugging.',
        'Talking to you — service notices, and product email you can unsubscribe from.',
        'Legal obligations — responding to lawful requests, and defending or establishing legal claims.',
      ],
      'That list is exhaustive. We do not run advertising, we do not build advertising profiles, we do not sell your data (section 6), and we do not use your data for any purpose outside what is written above.',
    ],
  },
  {
    id: 'training',
    heading: '4. Vera stores your data and trains on it — and that is not optional',
    body: [
      'This is the mechanism of the product, so it is stated plainly rather than buried. Vera has to store what you tell it, and it learns from what it stores. That is the difference between Vera and a chat window that forgets you: the reason it can account for a decision you made in March is that the March conversation is still there, and the reason its judgement improves is that it is trained on real founder problems rather than generic text.',
      'What that covers: your messages and Vera\'s replies, the facts and decisions Vera derived from them, the extracted content of files you uploaded, and any feedback you gave on a response.',
      'Because storage and training are how Vera works, they are not features you can switch off while continuing to use it. Signing up means agreeing to them. If you do not want your content stored and learned from, the honest answer is that Vera is not usable on those terms, and closing your account (section 7) deletes everything we hold. Where the law of your country gives you a right to object to this specific processing, section 9 tells you how to raise it — we will consider any objection properly, but in most cases honouring it means closing the account, because there is no version of Vera that runs without memory.',
      'What we limit, and hold ourselves to:',
      [
        'We aggregate and strip identifiers wherever the work does not require them — which is most of the time, because what we are usually trying to learn is a pattern, not a company.',
        'Training data sits under the same encryption and access controls as production data. It is not a looser copy in a spreadsheet somewhere.',
        'Your credentials and connected-account tokens are never training input. They are secrets, not text.',
        'We do not publish your content, and we will not use it in marketing, case studies, demos or public examples without asking you in writing first.',
        'We do not sell it, license it, or share it with anyone outside the processors in section 5.',
      ],
      'One honest limit, stated because the alternative is a promise we could not keep: where your content has already been incorporated into a trained model or an aggregated dataset, it cannot always be extracted from it afterwards. What deletion guarantees is that we stop using your data from that point on, that it is excluded from everything trained after it, and that every copy we hold in our own systems is destroyed as described in section 7.',
    ],
  },
  {
    id: 'sharing',
    heading: '5. Who else touches your data',
    body: [
      'Vera runs on other companies\' infrastructure. These are the ones that see your data, and exactly what each one gets. None of them pays us for access, and none of them is free to use your data for their own purposes.',
      [
        'Our authentication provider (Clerk) — your name, email and session data. It is how sign-in works.',
        'Our model provider (Groq) — the contents of the request Vera is answering: your question plus the context Vera assembled for it. This is how an answer gets generated. We send the minimum the answer needs and no more.',
        'Our hosting and database providers — everything, at rest, because that is where the application and the database physically live.',
        'Web search and page retrieval (DuckDuckGo, Jina Reader) — when a question needs current outside information, the search terms Vera constructs are sent out. Your identity is not attached to them.',
        'Providers you connect yourself (Google, Notion, Atlassian, Slack, Meta) — only the account you connected, only the scopes you granted, only while it stays connected.',
        'Professional advisers, and an acquirer if the company is ever sold or reorganised — in which case this policy travels with the data and we will tell you before anything changes.',
        'Law enforcement or a court — only where we are legally required, and we will notify you unless we are prohibited from doing so.',
      ],
      'Each of these is a processor acting on our instructions under a contract, not a party free to do as it likes. If we add a new one, section 12 applies: we update this list, bump the policy version, and tell you.',
    ],
  },
  {
    id: 'no-sale',
    heading: '6. We do not sell your data',
    body: [
      'We do not sell your personal data or your company data. We do not license it, rent it, trade it, or share it for anyone else\'s commercial benefit. We have never done so, and this policy does not reserve a right to start.',
      'Specifically, and as binding commitments:',
      [
        'No sale, licence, rental or barter of your data to any third party, in identified, pseudonymised or aggregated form.',
        'No sharing with data brokers, people-search services, background-check services, or advertising networks.',
        'No use of your data to target, profile or market to you on behalf of anyone else.',
        'No disclosure to anyone outside the processors listed in section 5, except where section 5 already says so — a legal requirement, or a corporate transaction in which this policy travels with the data.',
      ],
      'If that ever changed, it would be a change to the meaning of this policy, and section 12 governs it: you would be told in advance, and you would not be treated as having agreed by silence.',
    ],
  },
  {
    id: 'deletion',
    heading: '7. Deletion — what goes, and when',
    body: [
      'You can remove your data, and removal is real rather than a flag on a row. Two things do it:',
      [
        'Delete a chat, and we delete that conversation\'s messages, the files you attached to it and the extracted text of those files, plus the goal, roadmap, decision cards and feedback that came from it. Vera loses that thread and everything it derived from it.',
        'Close your account, and we delete everything: every chat and message, every uploaded file, your business profile and onboarding answers, the company facts and dossier that make up Vera\'s memory of you, your monthly reviews, your workflows, your settings, and our copy of any connected-account tokens. Nothing of yours is kept as a residual profile.',
      ],
      'Timing: both happen immediately when you ask, not on a queue. Encrypted backups are the one exception — they roll off within 30 days, so a deleted item can persist in a backup for up to that long before it is gone from every system we operate. We do not restore a backup to recover data you deleted.',
      'Two limits, both stated because they are true and a policy that hid them would be the misleading part. First, the trained-model limit at the end of section 4. Second, disconnecting a connector deletes our copy of the access token but does not revoke it at Google, Notion, Slack or Meta — you should revoke access in that provider\'s own security settings as well, and we cannot do that for you.',
      'While your account is open, we keep what section 2 describes, because Vera\'s usefulness is a direct function of how much of your history it still has. Technical logs are kept for a short operational window and then discarded.',
    ],
  },
  {
    id: 'security',
    heading: '8. How we protect it',
    body: [
      'Your data is the record of how your company actually runs, and it is treated that way.',
      [
        'Traffic is encrypted in transit (TLS). The database is encrypted at rest.',
        'Connected-account OAuth tokens are encrypted with AES-256-GCM before storage, separately from everything else.',
        'Every data request is authenticated against a verified session and scoped to your own user id on the server, not merely in the interface. Uploaded files are not publicly served — they are reachable only through an authenticated request for a file you own.',
        'Uploads are stored under server-generated filenames, never a path derived from anything you typed.',
        'Internal access to production data is limited to the people who need it to operate or debug the service.',
      ],
      'What we will not claim: that any system is perfectly secure. Anyone who tells you their infrastructure cannot be breached is either mistaken or selling something, and a promise of absolute security is one we would be answerable for the day it failed. What we commit to instead is the measures above, and this: if a breach affects your data we will tell you and the relevant regulator without undue delay — within 72 hours of becoming aware, where that duty applies to us — and we will tell you what we actually know rather than what sounds best.',
    ],
  },
  {
    id: 'rights',
    heading: '9. Your choices and your rights',
    body: [
      `One address for all of it: ${POLICY_META.contactEmail}. We answer within 30 days and will not make you fill in a form to exercise a right.`,
      [
        'Get a copy of what we hold about you, in a portable format.',
        'Correct anything that is wrong.',
        'Delete a chat, or your entire account and everything in it (section 7).',
        'Disconnect any connected account at any time.',
        'Opt out of anything that is not required for Vera to function — product email, and any future processing that section 12 introduces.',
        'Object to or restrict a particular use, and withdraw any consent you gave separately from this policy.',
        'Complain to your local data protection authority. You do not have to come to us first, though we would rather you did.',
      ],
      'The one thing you cannot switch off while continuing to use Vera is the storing of and training on your content, for the reason given in section 4: it is not a feature layered on top of Vera, it is how Vera works. Your control over it is the control described in section 7 — delete the chat, or close the account and take everything with you.',
    ],
  },
  {
    id: 'transfers',
    heading: '10. Where your data goes',
    body: [
      `We operate from ${POLICY_META.jurisdiction}, and the providers in section 5 operate in the United States and the European Union. Using Vera means your data crosses borders. Where it leaves a jurisdiction that restricts transfers, we rely on the standard contractual protections our providers offer, and we do not transfer data to a provider that offers none.`,
    ],
  },
  {
    id: 'compliance',
    heading: '11. The law we hold ourselves to',
    body: [
      'We comply with the data protection law that applies to you, not only the law where we happen to be sitting. That includes the GDPR in the UK and EEA, the Digital Personal Data Protection Act in India, and the state privacy laws in the United States, as each applies.',
      'Where those regimes differ, we apply the standard most protective of you, and we extend the rights in section 9 to everyone regardless of where they live — running two standards is how the lower one quietly becomes the real one.',
      'Our commitment underneath all of it is simpler than the statutes: your data is used to run Vera and to make Vera better for you. It is not misused, not sold, not repurposed for something you would not expect, and not treated as an asset separate from the service you came here for.',
    ],
  },
  {
    id: 'changes',
    heading: '12. If this policy changes',
    body: [
      'This policy is versioned. If we change what we actually do with your data, then before the change takes effect we will bump the version, email you, and ask you to read and accept the new wording the next time you open Vera. Small clarifications that do not change meaning we will simply date.',
      'You will not be treated as having agreed to a material change by silence, by continuing to use Vera, or by not reading an email. And where a change introduces processing that is not necessary for Vera to function, you will be able to decline that part specifically and keep using Vera without it. Only what section 4 describes is non-optional.',
      'We will not use a silent edit to acquire a permission you did not give.',
    ],
  },
  {
    id: 'contact',
    heading: '13. Contact',
    body: [
      `Questions, requests, or something in here that turns out to be wrong: ${POLICY_META.contactEmail}. If you tell us this policy does not match what the product does, we will treat it as a bug in the product or a bug in the policy, and fix whichever one is broken.`,
    ],
  },
];

/* ---------------------------------------------------------------- ownership */

/**
 * Ownership, warranties and liability. Strictly speaking this is terms-of-use
 * material and will eventually want its own document — but it is shown on the
 * same first-run screen and rendered under its own labelled heading, for one
 * reason: the first-run screen is the only moment where you can be certain a
 * person saw something before they used the product. A liability limit nobody
 * was shown is a liability limit that is hard to rely on.
 *
 * Kept separate from POLICY_SECTIONS rather than appended to it so the split
 * stays visible in code, and so pulling this into a real /terms document later
 * is a move rather than a surgery.
 */
export const OWNERSHIP_SECTIONS: readonly PolicySection[] = [
  {
    id: 'ownership',
    heading: '14. Vera is our property',
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
    heading: '15. Your content stays yours',
    body: [
      'The reciprocal half, and it matters as much: your business data, your files and what you write to Vera remain yours. We claim no ownership of them.',
      'What you grant us is a licence to store and process that content for the purposes set out in this policy — running Vera for you, and training and improving it as described in section 4. Nothing more. If you close your account, that licence ends with it and the content is deleted under section 7.',
      'What Vera writes back to you — analyses, drafts, reviews, recommendations — is yours to use in your business freely, including commercially, subject only to section 14: do not present Vera itself as your own product.',
    ],
  },
  {
    id: 'no-advice',
    heading: '16. No warranty, no advice, and no guarantee of accuracy',
    body: [
      'Read this section properly. It is the one that describes what Vera is not.',
      'Vera produces analysis and recommendations generated by a language model from the information available to it. It can be wrong, and it can be wrong while sounding certain. It can misread a number, miss context you did not give it, rely on outdated information, or reason from a false premise. Accuracy is what we build towards; it is not something we can guarantee, and nothing in the product or our marketing should be read as guaranteeing it.',
      'That includes our marketing language. Phrases used to describe Vera — including "the cause behind every decision" and any similar claim on our website, in advertising, or in the product — describe what Vera is designed to do and what it aims at. They are positioning, not a warranty. Vera does not and cannot guarantee that it has identified the true cause of anything, that a recommendation is correct, or that following it will produce a particular result.',
      'Vera is not professional advice of any kind, and using it creates no professional or fiduciary relationship between us. It is not legal, financial, investment, tax, accounting, regulatory, employment, insurance, engineering, medical, psychological or safety advice, and it is not a substitute for a qualified, accountable, licensed human being. Specifically:',
      [
        'Every output is information for you to evaluate, not an instruction to follow and not a decision made on your behalf.',
        'Every decision you make after reading a Vera output remains entirely your decision, made on your own judgement and at your own risk.',
        'Anything consequential — a number, a contract, a filing, a hire, a firing, a price change, a legal or regulatory question, anything affecting someone\'s money, employment, health or safety — must be independently verified with a qualified professional before you act on it.',
        'Vera has no way to know your full circumstances, and its outputs are not tailored advice even when they read as though they are.',
      ],
      'To the fullest extent the law allows, Vera is provided "as is" and "as available", with no warranties of any kind, whether express, implied or statutory. We specifically disclaim any implied warranty of merchantability, fitness for a particular purpose, accuracy, completeness, reliability, non-infringement, and uninterrupted or error-free operation. We do not warrant that Vera will be available at any given time, that it will be free of bugs or defects, that any defect will be fixed, that data will never be lost, or that outputs will be consistent between one request and the next.',
    ],
  },
  {
    id: 'liability',
    heading: '17. Limits on our liability',
    body: [
      'Because Vera makes suggestions and you make decisions, the risk of acting on a suggestion sits with you. This section says so in the terms the law uses.',
      'To the fullest extent permitted by applicable law, and except where this section says otherwise:',
      [
        'We are not liable for any loss or damage arising from your use of Vera or your reliance on anything it produces — including any decision you took, did not take, or delayed because of an output.',
        'We are not liable for indirect, incidental, special, consequential, exemplary or punitive damages; nor for loss of profits, revenue, business, contracts, opportunity, anticipated savings, goodwill, reputation, or data; nor for business interruption or the cost of substitute services — whether or not such losses were foreseeable and whether or not we were told they were possible.',
        'We are not liable for the accuracy, completeness or usefulness of any output, for any act or omission of a third-party provider listed in section 5, for anything caused by your own act, omission, configuration or misuse, or for any event beyond our reasonable control (including outages, network failures, provider failures, changes in third-party services, and force majeure).',
        'Our total aggregate liability for all claims, however arising and whether in contract, tort (including negligence), statute or otherwise, is limited to the greater of the total fees you actually paid us for Vera in the twelve months before the claim arose, or one hundred United States dollars (US$100).',
        'Any claim must be brought within one year of the event giving rise to it, or as soon after that as applicable law requires it to be permitted.',
      ],
      'WHAT THIS DOES NOT EXCLUDE, because no drafting can and pretending otherwise would put the whole section at risk: nothing here limits our liability for death or personal injury caused by our negligence, for fraud or fraudulent misrepresentation, for gross negligence or wilful misconduct, or for anything else that applicable law does not permit to be limited or excluded — including any non-waivable statutory or consumer right you have. If you are a consumer under the law of your country, your statutory rights are unaffected by anything in this document.',
      'If any part of this section, or of section 16, is held unenforceable in a particular jurisdiction, that part is to be read as narrowed to the minimum extent needed to make it enforceable, and every other part stays in force. The rest of this document survives the removal of any single clause.',
      `These terms are governed by the law of ${POLICY_META.jurisdiction}, without prejudice to any mandatory protection available to you under the law of the country in which you live.`,
    ],
  },
  {
    id: 'your-duties',
    heading: '18. Your side of it',
    body: [
      'In exchange for the above, a short list of things that are yours to get right:',
      [
        'Use Vera lawfully, and do not use it to break the law, infringe anyone\'s rights, or harm anyone.',
        'Only put data into Vera that you are entitled to share. If you paste someone else\'s personal data — a customer list, an employee\'s details, a third party\'s confidential information — you are confirming you have the right to, and you are responsible for that.',
        'Keep your credentials secure, and tell us promptly if you think your account has been compromised.',
        'Do not attempt to break, overload, probe or circumvent the service or its security, and do not use it to build a competing product (section 14).',
        'You are responsible for verifying outputs before acting on them (section 16), and for your own backups of anything you cannot afford to lose.',
      ],
      'You agree to indemnify us against third-party claims, losses and reasonable costs arising from your breach of this section — including any claim brought by someone whose data you put into Vera without the right to do so. This does not apply to anything caused by our own breach, negligence or wrongdoing.',
      'We may suspend or close an account that breaches these terms. Where the circumstances allow it, we will tell you first and give you a chance to put it right; where a breach is causing harm or is unlawful, we may act immediately. Closing an account under this section does not affect your deletion rights in section 7.',
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
