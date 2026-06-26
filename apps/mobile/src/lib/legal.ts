export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDoc {
  title: string;
  subtitle: string;
  updated: string;
  sections: LegalSection[];
}

export const privacy: LegalDoc = {
  title: 'Privacy Policy',
  subtitle: 'How OctoChat handles your data — or rather, how it doesn\'t.',
  updated: 'June 2026',
  sections: [
    {
      title: 'Overview',
      paragraphs: [
        'OctoChat is end-to-end encrypted team chat software. Every message, attachment, and reaction is sealed on your device before it is transmitted or stored. Neither Drakkar Software nor any server operator can read your communications.',
        'This policy describes what minimal information is associated with your use of OctoChat and how it is handled.',
      ],
    },
    {
      title: 'Your Identity and Keys',
      paragraphs: [
        'Your cryptographic identity (Ed25519 signing key, Kyber encryption key) is derived locally from a BIP-39 mnemonic seed phrase that you generate during onboarding. Your seed phrase never leaves your device and is never transmitted to any server.',
        'Profile information such as your display name and pseudonym is encrypted before storage. The server holds ciphertext; it has no way to associate a readable identity with your key material.',
      ],
    },
    {
      title: 'Message Content',
      paragraphs: [
        'All messages are encrypted client-side using per-room symmetric keys before being sent to the server. The server stores and delivers opaque encrypted blobs. It cannot read, index, or analyse your messages.',
        'Attachments (images, files) are encrypted with the same per-room keys. File content is never accessible to the server.',
      ],
    },
    {
      title: 'Server Metadata',
      paragraphs: [
        'Basic connection metadata — document identifiers, timestamps, and the size of encrypted payloads — is necessarily visible to the server in order to route and deliver messages. This metadata does not include any message content.',
        'OctoChat may collect a few completely anonymous in-app analytics — such as error events — and does not use tracking pixels, advertising SDKs, or any third-party library that reports usage data to external parties.',
      ],
    },
    {
      title: 'Self-Hosted Deployments',
      paragraphs: [
        'OctoChat is designed to be self-hosted. When you run your own Starfish server, you control all infrastructure, logs, and data retention policies.',
        'If you use a server operated by a third party (a team admin, an employer, etc.), their privacy practices govern the infrastructure they control — including metadata, access logs, and backup retention. They cannot read your encrypted message content, but they do control server-level metadata.',
        'Drakkar Software has no visibility into, and no responsibility for, the data handling practices of third-party server operators.',
      ],
    },
    {
      title: 'Push Notifications',
      paragraphs: [
        'Push notifications, when enabled, are delivered through platform services (Apple APNs, Google FCM). By default OctoChat sends generic alerts ("New message") without decrypted content.',
        'If you enable notification previews in Settings, a decrypted message preview is generated on-device and passed to the platform notification service. Drakkar Software recommends leaving previews disabled on shared or untrusted devices.',
      ],
    },
    {
      title: 'Data Retention',
      paragraphs: [
        'OctoChat is a persistent, append-only system by design. Messages and server-side records are retained per the server operator\'s infrastructure policy. There is no "delete account" feature — this is intentional: the append-only model is fundamental to the security and auditability of the system.',
        'You may remove OctoChat from your device at any time, which discards your local keys. Because messages are end-to-end encrypted, your local keys are the only way to decrypt stored ciphertext. Removing them renders your message history permanently inaccessible on that device — without recovery, by design.',
      ],
    },
    {
      title: 'Children\'s Privacy',
      paragraphs: [
        'OctoChat is not directed at children under the age of 13. We do not knowingly process information relating to minors. If you believe a minor has created an account, please contact us at the address below.',
      ],
    },
    {
      title: 'Changes to This Policy',
      paragraphs: [
        'We may update this policy to reflect changes in the software or applicable law. Material changes will be communicated through the application release notes or the official OctoChat repository.',
        'Continued use of OctoChat after a policy update constitutes acceptance of the revised terms.',
      ],
    },
    {
      title: 'Contact',
      paragraphs: [
        'Questions or concerns about this Privacy Policy? Reach us at privacy@drakkar.software or open an issue in the public OctoChat repository.',
      ],
    },
  ],
};

export const terms: LegalDoc = {
  title: 'Terms of Service',
  subtitle: 'What you can do with OctoChat, and what we ask of you.',
  updated: 'June 2026',
  sections: [
    {
      title: 'Acceptance',
      paragraphs: [
        'By installing, accessing, or using OctoChat you agree to be bound by these Terms of Service. If you do not agree with any part of these Terms, do not use the software.',
        'These Terms apply to all users of OctoChat, whether connecting to the official hosted service, a self-hosted Starfish server, or running the software locally.',
      ],
    },
    {
      title: 'Open-Source License',
      paragraphs: [
        'OctoChat client code and the OctoChat SDK are released under the MIT License. You may freely use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, subject to the license conditions.',
        'The Starfish server software is licensed separately; refer to its repository for applicable terms. Third-party dependencies carry their own licenses.',
      ],
    },
    {
      title: 'Description of the Service',
      paragraphs: [
        'OctoChat provides end-to-end encrypted team chat software. Messages are encrypted on your device; the server stores only ciphertext. You are solely responsible for the security of your seed phrase.',
        'Lost or forgotten seed phrases cannot be recovered by Drakkar Software. There is no password reset, no backdoor, and no key escrow. Treat your seed phrase like a private key — back it up securely and never share it.',
      ],
    },
    {
      title: 'Self-Hosting Responsibility',
      paragraphs: [
        'If you operate a Starfish server for yourself or others, you bear full responsibility for its security, availability, and legal compliance. This includes data protection obligations in your jurisdiction, secure configuration, and timely security updates.',
        'You must not use the software to host, store, or distribute content that is illegal in your jurisdiction or in the jurisdiction of your users.',
      ],
    },
    {
      title: 'Acceptable Use',
      paragraphs: [
        'You agree not to use OctoChat to: (a) violate any applicable local, national, or international law or regulation; (b) transmit or facilitate the transmission of malware, spam, or unsolicited communications; (c) harass, stalk, threaten, or harm any individual; (d) attempt to undermine the security or integrity of OctoChat or any Starfish server you do not operate; or (e) resell or white-label the service without prior written permission.',
        'We reserve the right to terminate access to any officially operated service for users who violate these terms.',
      ],
    },
    {
      title: 'No Warranty',
      paragraphs: [
        'OctoChat is provided "as is" and "as available", without warranty of any kind, express or implied. We do not warrant uninterrupted or error-free operation, security against all attack vectors, fitness for a particular purpose, or the permanent preservation of any data.',
        'Cryptographic security relies on correct implementation of published open standards (Ed25519, Kyber, AES-GCM). We make reasonable efforts to maintain correctness and to address security disclosures promptly, but no software is free of bugs.',
      ],
    },
    {
      title: 'Limitation of Liability',
      paragraphs: [
        'To the maximum extent permitted by applicable law, Drakkar Software and its contributors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of data, arising from your use of or inability to use OctoChat.',
        'Our aggregate liability for any claim arising from these Terms shall not exceed one hundred euros (€100).',
      ],
    },
    {
      title: 'Governing Law and Disputes',
      paragraphs: [
        'These Terms are governed by the laws of France, without regard to conflict-of-law provisions. Any dispute arising under these Terms shall be submitted to the exclusive jurisdiction of the competent courts of Paris, France.',
      ],
    },
    {
      title: 'Changes to These Terms',
      paragraphs: [
        'We may revise these Terms from time to time. The most current version will always be available in the application and in the official OctoChat repository. Material changes will be flagged in the release notes.',
        'Continued use of OctoChat after a revision becomes effective constitutes your acceptance of the updated Terms.',
      ],
    },
    {
      title: 'Contact',
      paragraphs: [
        'Legal questions? Contact us at legal@drakkar.software or open an issue in the public OctoChat repository at github.com/drakkar-software/octochat.',
      ],
    },
  ],
};
