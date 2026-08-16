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

   THREE ARRAYS, RENDERED AS THREE BLOCKS: POLICY_SECTIONS (1-13, privacy),
   OWNERSHIP_SECTIONS (14-18, terms of use), ADDITIONAL_SECTIONS (19-25,
   cookies / region-specific rights / dispute resolution / definitions — see
   the note above that array for why it's a third array instead of being
   folded into one of the first two). Both surfaces must render all three, in
   order.

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
      'Vera is a business tool. It is built for founders and operators, and offered to businesses and professionals for use in connection with their business — it is not offered, marketed or intended for personal, family or household use. If you use Vera, you do so in a business capacity, whether that is your own business or one you work for, and not as a consumer.',
      'Vera accounts are individual today — there is no shared or organisation-level account, and nobody but you can reach what is stored under your account, in the way section 21 describes. If that ever changes — a shared workspace, an invited teammate, anything that gives someone other than you access to what you have built in Vera — this policy will be updated to say exactly what that means for visibility inside it, and you will be asked to read and accept the change before any shared access begins, the same way section 12 already governs any other change.',
      'Vera is a product for businesses, and we ask for a work email address when you sign up. We do not direct Vera at children, we do not market it to them, and we do not knowingly collect personal data from a child. If you believe a child has given us data, write to us at the address in section 13 and we will delete it.',
      'Where this policy says "your data", it means both personal data about you and commercial data about your company. Both are treated the same way here, because in practice they arrive mixed together in the same sentence.',
      'Sections 1 to 13 are the privacy policy. Sections 14 to 18 are the terms on which Vera is provided — ownership, the limits of what Vera can promise you, and the limits of what we are liable for. Sections 19 onward are additional disclosures — cookies, region-specific rights, and definitions. Using Vera means agreeing to all of it.',
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
        'Cookies — a small number of first-party, strictly-necessary cookies. No advertising or analytics tracking. Section 19 lists every one.',
      ],
      'We do not ask for and do not want: payment card numbers (our payment provider handles those and we never see the full number), government identifiers, health data, biometric data, genetic data, data revealing racial or ethnic origin, political opinions, religious or philosophical beliefs, trade union membership, sexual orientation or sex life, criminal records, or your own customers\' personal data. Please do not paste any of those into a chat. If you do, you are responsible for having the right to share it, and section 18 applies.',
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
    heading: '4. How Vera stores and learns from your data',
    body: [
      'Vera works by remembering your business. It stores what you tell it and learns from it, which is what lets it pick up a decision you made months ago instead of asking you to explain your company over again, and what lets its judgement keep improving the more it works with you — a colleague who remembers your last conversation is more useful than one who does not.',
      'What that covers: your messages and Vera\'s replies, the facts and decisions Vera derives from them, the extracted content of files you upload, and any feedback you give on a response.',
      'Storing and learning from your content is built into how Vera works, not a separate feature layered on top of it, so it is part of using Vera rather than a switch you set independently of the rest of the product. If you would rather your content were not stored or learned from, closing your account (section 7) removes everything we hold, and where the law of your country gives you a right to object to this specific processing, section 9 explains how to raise it.',
      'For readers in the UK or EEA, this is our lawful basis under the GDPR, named directly rather than left for you to infer. Storing your content and using it to answer you — the core function of the product — is necessary for the performance of our contract with you (Article 6(1)(b)). Using that content, usually aggregated and stripped of anything that identifies your company, to improve Vera\'s judgement more broadly is based on our legitimate interests in operating and developing the product (Article 6(1)(f)), weighed against your right to privacy — which is why section 4 limits what that involves, and why Article 21 gives you a right to object to it. Where you object, honouring that in practice means closing the account, for the reason already given: there is no version of Vera that runs without this.',
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
      'While your account is open, we keep what section 2 describes, because Vera\'s usefulness is a direct function of how much of your history it still has. Technical and request logs are kept for up to 90 days and then discarded.',
    ],
  },
  {
    id: 'security',
    heading: '8. How we protect it',
    body: [
      'Your data is the record of how your company actually runs, and it is treated that way: encrypted, access-controlled, and used to power your experience with Vera — not handed to outside companies. We do not share it with advertisers, data brokers, or anyone outside the small set of infrastructure and connector providers named in section 5, each of which is contractually bound to use it only to help run Vera for you.',
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
        'If you are in California and we deny a request, appeal it — write back and ask us to reconsider. We respond to appeals within 45 days.',
      ],
      'The one thing you cannot switch off while continuing to use Vera is the storing of and training on your content, for the reason given in section 4: it is not a feature layered on top of Vera, it is how Vera works. Your control over it is the control described in section 7 — delete the chat, or close the account and take everything with you.',
      'We will not deny you goods or services, charge you a different price, or give you a different level of service because you exercised any right in this section. In the specific terms California\'s privacy law uses: we have not sold or shared — as the CCPA defines those words — your personal information in the preceding twelve months, and section 6 governs us if that ever changes. Section 20 restates the rights above in the format California law requires, with the categories of information involved.',
    ],
  },
  {
    id: 'transfers',
    heading: '10. Where your data goes',
    body: [
      `We operate from ${POLICY_META.jurisdiction}, and the providers in section 5 operate in the United States and the European Union. Using Vera means your data crosses borders. Where it leaves a jurisdiction that restricts transfers, the mechanism we rely on is the European Commission's Standard Contractual Clauses — and, for transfers out of the UK, the UK's International Data Transfer Addendum to those clauses — incorporated into our contracts with the providers in section 5. We do not transfer data to a provider that has not signed one.`,
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
      'For readers in India: the address above is also our Grievance Officer contact under the Digital Personal Data Protection Act. We acknowledge a grievance within 7 days and aim to resolve it within 30 — the same window every other request in section 9 gets.',
    ],
  },
];

/* ------------------------------------------------------ additional disclosures */

/**
 * Region-specific and structural clauses that don't belong inside the main
 * numbered flow of POLICY_SECTIONS or OWNERSHIP_SECTIONS, so they are a third
 * array rather than inserted into either — inserting them there would
 * renumber every section after the insertion point, and this document is
 * cross-referenced by number ("see section 5", "section 16", etc.) often
 * enough that a renumbering pass is real risk for no real benefit. Appending
 * a third block, continuing the numbering from 19, adds every one of these
 * without touching a single existing cross-reference. Real contracts do this
 * routinely — a jurisdiction-specific addendum at the end is normal, not a
 * sign the document is disorganised.
 */
export const ADDITIONAL_SECTIONS: readonly PolicySection[] = [
  {
    id: 'cookies',
    heading: '19. Cookies and similar technologies',
    body: [
      `There is no advertising or analytics tracking on this site — no third-party tag, no pixel, and nothing that follows you to another website. Everything below is set by ${OWNER_NAME} or by the authentication provider named in section 5, and it falls into two groups: the part that is required, and the part you choose.`,
      'Required, and not subject to a choice, because without them there is no working product. There is no consent banner for these, and none is needed — each one exists to deliver something you asked for:',
      [
        'A session cookie from our authentication provider (section 5) — how you stay signed in. Without it you would have to sign in again on every page.',
        'A short-lived cookie used only for the few seconds it takes to connect a third-party account (Gmail, Notion, and the others in section 2), to verify the connection request came from you. Deleted immediately after.',
        'A record, kept in your browser, of which version of this policy you accepted and what you chose about the optional storage below. Storing your refusal is what stops you being asked again on every page.',
        'A record, kept in your browser, of where you are in signing up, and a local index of your own chats and saved analyses. The chat index is required rather than optional because it is what the sidebar lists your conversations from — clearing it would make your own history unreachable in the interface, so it is not something we treat as a preference you can decline.',
      ],
      'Preferences, which you can switch off. These are settings and dismissals only — no content, nothing that identifies you, and nothing that leaves your device:',
      [
        'Your theme and visual identity choices, whether the sidebar and the goal and roadmap panels were left open, which cards you dismissed, and a cache of company reports already fetched so the same one is not requested twice.',
      ],
      'You are not shown a cookie consent banner, and that is a deliberate decision rather than an omission. A banner is required for tracking, advertising and analytics technology, and there is none of that here. What is left is the list directly above: settings you created by clicking something in the interface, kept so the product looks the way you left it. Storage of that kind, set as the result of your own explicit choice, does not require consent — and asking permission for a dark-mode setting would train you to click past the notice that will matter if that ever changes.',
      'You can still turn it off. Settings → General has a control for it, and switching it off deletes what is already stored rather than merely recording that you objected. Vera stays fully functional either way; it simply starts from defaults each time. If tracking or analytics technology is ever introduced, a consent request will appear before any of it runs.',
      'Most of the preference items above are stored using your browser\'s local storage rather than as cookies. That is a technical distinction and not a legal one: it is still information kept on your device, so it is disclosed here and covered by the same control.',
      'We do not store your IP address. The server reads the connecting address transiently, in memory, to rate-limit requests that are not signed in and to protect the service from abuse; it is not written to our database, not linked to your account, and the request log records only the method and path of a request. If this ever changes, this section changes with it under section 12.',
      'If advertising or analytics technology is ever added, this section changes with it, section 12 governs how, and consent will be asked for where the law requires it before any such technology is used.',
    ],
  },
  {
    id: 'california',
    heading: '20. California privacy rights',
    body: [
      'This section restates rights already given in section 9, in the categories and format California\'s privacy law (the CCPA, as amended by the CPRA) asks for.',
      'Categories of personal information collected about California residents in the preceding twelve months, and why:',
      [
        'Identifiers — name, email address, IP address, an internal account ID. To create and secure your account.',
        'Internet or network activity — browser and device information, request logs. To run the service and prevent abuse.',
        'Professional information — your role, your company\'s name, stage and industry. To calibrate Vera\'s advice to your business.',
        'Inferences drawn from the above — the facts, decisions and patterns Vera derives from your activity (section 2). This is the memory layer the product is built on.',
      ],
      'We have not sold or shared — as the CCPA specifically defines those words — any of these categories to any third party, and section 6 governs us if that ever changes. We do not collect sensitive personal information as the CCPA defines it, so there is no use of sensitive personal information to limit.',
      'Your rights: everything in section 9, plus the right to appeal a denial of a request (write to section 13\'s address and ask us to reconsider — we respond within 45 days) and the right not to be discriminated against for exercising any of them. An authorised agent may make a request on your behalf; we will ask for evidence you gave them permission to.',
    ],
  },
  {
    id: 'takedown',
    heading: '21. Notice and takedown for intellectual property complaints',
    body: [
      'Files you upload in Vera are used by you, for you — nothing you upload is published or made visible to anyone outside your own account. Because of that, the situation this section exists for (someone claiming material visible to other users infringes their rights) does not really arise in how Vera works today. We are stating a process anyway, so a legitimate complaint always has somewhere to go, and so there is one if that ever changes.',
      `If you believe something on Vera infringes your copyright or other intellectual property rights, write to the address in section 13 with: a description of the work you claim is infringed, the specific material you are complaining about and where it is, your contact details, and a good-faith statement that the use is not authorised. We will investigate and, where the complaint is valid, remove or disable access to the material and tell the account holder why.`,
    ],
  },
  {
    id: 'survival',
    heading: '22. What survives closing your account',
    body: [
      'Closing your account ends this agreement, but not every part of it stops applying. Sections 14 (ownership), 15 (to the extent it describes what happens to your content afterward), 16 (no warranty), 17 (limits on our liability), 18 (your duties, including the indemnity), 21 (intellectual property complaints), 24 (dispute resolution) and 25 (definitions) continue to apply after your account is closed or this agreement otherwise ends. What happens to your data itself is a separate question, governed by section 7, not by this one.',
    ],
  },
  {
    id: 'assignment',
    heading: '23. Assignment',
    body: [
      'You may not assign or transfer your rights or obligations under this agreement without our written consent. We may assign it, in whole, without needing yours, in connection with a merger, acquisition, reorganisation, or sale of substantially all of our assets — the same kind of transaction section 5 already tells you about. An assignment under this section does not reduce the protections this document gives you.',
    ],
  },
  {
    id: 'disputes',
    heading: '24. Dispute resolution: arbitration, class waiver and venue',
    body: [
      'Most disagreements get resolved faster one-on-one than in a courtroom or as part of a group action. This section is about the disputes between you and us over these terms or your use of Vera — it does not limit your right to complain to a data protection authority or other regulator, which section 9 covers separately and which cannot be signed away.',
      [
        `You and ${OWNER_NAME} agree to resolve any dispute arising out of or relating to these terms or your use of Vera through binding arbitration on an individual basis, rather than in court, except where this section says otherwise. Choosing arbitration means both of us are giving up the right to a jury trial and to litigate this in court.`,
        'Claims are brought only in an individual capacity — not as a plaintiff or class member in any class, collective, consolidated or representative proceeding, and not combined with anyone else\'s claim without every party\'s consent. An arbitrator has no authority to conduct a class or representative arbitration.',
        `Arbitration is seated in ${POLICY_META.jurisdiction}, conducted in English under the Arbitration and Conciliation Act, 1996, before a single arbitrator. Each side bears its own costs unless the arbitrator decides otherwise.`,
        'Carved out of arbitration entirely: either of us may go to a court of competent jurisdiction for injunctive or other equitable relief over actual or threatened infringement, misappropriation or misuse of intellectual property or confidential information (sections 14 and 15) — that kind of harm needs a court\'s power to stop it quickly, not an arbitrator\'s schedule. Either of us may also bring an individual claim in small claims court instead of arbitration, where that court has jurisdiction and the claim qualifies.',
        `For anything this section sends to court rather than arbitration, the courts of ${POLICY_META.jurisdiction} have exclusive jurisdiction, and both of us consent to that.`,
        'If the class-action waiver above is found unenforceable for a particular claim, that claim — and only that claim — may proceed in court instead of arbitration. Every other part of this section, and of this agreement, stays in force.',
      ],
    ],
  },
  {
    id: 'definitions',
    heading: '25. Definitions',
    body: [
      'A handful of words used throughout this document, defined once here rather than re-explained every time they appear:',
      [
        `"Vera", "we", "us" or "our" means ${OWNER_NAME}.`,
        '"You" or "your" means the person or business using Vera under an account.',
        '"Content" means anything you type, upload, connect or otherwise submit to Vera, and anything Vera generates in response.',
        '"Account" means the credentials and settings that let you sign in, and the data associated with them — individual to you, not shared, for as long as that remains true (section 1).',
        '"Personal data" or "personal information" means information that identifies or could reasonably be linked to you or your business, as those terms are defined under applicable law.',
        '"Processor", "provider" or "subprocessor" means a third party that processes data on our instructions, as listed in section 5.',
      ],
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
      `${OWNER_NAME} owns Vera. The name and mark are our trademark. The exact design, layout and visual presentation of our screens — the landing page, the chat interface, the dossier, and every other page — is our copyrighted work. The software, our prompts and system instructions, the memory and dossier architecture, our model configuration and our documentation are our confidential and proprietary information, held as trade secrets and protected by the licence terms below. Nothing in this document transfers any of it to you.`,
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
      'Vera produces analysis, recommendations and information generated by an artificial intelligence system. Any decision, action or omission taken in reliance on that output is undertaken entirely at your own discretion and at your own risk, and not at our direction.',
      'To the fullest extent permitted by applicable law, and except where this section provides otherwise:',
      [
        'We disclaim liability for any loss, damage, cost or expense arising out of or in connection with your use of, or reliance upon, Vera or any output it produces — including any decision you took, did not take, or delayed as a result.',
        'We disclaim liability for indirect, incidental, special, consequential, exemplary or punitive damages, and for loss of profits, revenue, business, contracts, anticipated savings, goodwill, reputation or data, whether arising in contract, tort (including negligence), statute or otherwise, and whether or not such loss was foreseeable.',
        'We disclaim liability for the accuracy, completeness, reliability or suitability of any output, for any act or omission of a third-party provider listed in section 5, for anything arising from your own configuration, misuse or breach of these terms, or for any event beyond our reasonable control.',
        'Our total aggregate liability for all claims arising out of or relating to Vera or these terms, however arising and whether in contract, tort (including negligence), statute or otherwise, is limited to the greater of the total fees you paid us for Vera in the twelve months before the claim arose, or one hundred United States dollars (US$100).',
      ],
      'This section does not exclude or limit liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, for gross negligence or wilful misconduct, or for anything else that applicable law does not permit to be limited or excluded, including any non-waivable statutory or consumer right. If you are a consumer under the law of your country, your statutory rights are unaffected by this document.',
      'If any part of this section, or of section 16, is held unenforceable in a particular jurisdiction, that part is to be read as narrowed to the minimum extent needed to make it enforceable, and every other part stays in force. The rest of this document survives the removal of any single clause.',
      `These terms are governed by the law of ${POLICY_META.jurisdiction}, without prejudice to any mandatory protection available to you under the law of the country in which you live. Section 24 governs how a dispute is actually brought.`,
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
  },
  landing: {
    heading: 'var(--lp-text)',
    body: 'var(--lp-text-2)',
    strong: 'var(--lp-text)',
  },
} as const;

export type PolicyTone = keyof typeof TONE;

// There used to be a PolicySummary component here — a short "in plain terms"
// bullet list rendered above the full text on both surfaces. Removed on
// instruction: read the actual document, not a paraphrase of it. Both
// PrivacyGate.tsx and PrivacyPolicyPage.tsx now render PolicyProse directly.

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
