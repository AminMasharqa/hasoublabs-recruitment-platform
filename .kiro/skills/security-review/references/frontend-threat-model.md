# Portfolio Frontend Threat Model

Assets: candidate identity, contact details, repository links, visitor privacy, site integrity, and professional credibility.

Trust boundaries: user-entered form data, URL parameters, third-party scripts, embedded media, analytics, external links, downloaded résumé files, and generated HTML.

Review for:

- tokens, credentials, private endpoints, or sensitive personal data;
- dynamic HTML sinks such as `dangerouslySetInnerHTML`, `v-html`, or raw HTML insertion;
- insecure `http://` resources and untrusted scripts;
- `target="_blank"` links without `noopener noreferrer`;
- forms that collect data without explaining where it goes;
- analytics or trackers added without need or consent;
- résumé files containing home address, private phone, or hidden metadata;
- dependencies or deployment configuration outside the approved task.
