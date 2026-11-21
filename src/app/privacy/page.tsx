import type { Metadata } from "next"
import { ShieldCheck } from "lucide-react"
import {
  LegalDocument,
  LegalList,
  LegalNote,
  LegalP,
  type LegalSection,
} from "@/components/legal/legal-document"
import { hasSignedInUser } from "@/components/legal/legal-session"
import { COUNCIL_CONTACT } from "@/lib/council-info"

export const metadata: Metadata = {
  title: "Privacy Policy | CEIT Connect",
  description: "What personal information CEIT Connect collects, why, and how it is protected.",
}

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    content: (
      <>
        <LegalP>
          CEIT Connect is run by the {COUNCIL_CONTACT.organization} of {COUNCIL_CONTACT.institution}. The council
          decides why and how your personal information is used in the workspace, and is responsible for
          protecting it.
        </LegalP>
        <LegalP>
          This policy follows the Data Privacy Act of 2012 (Republic Act No. 10173) of the Philippines. It explains
          what we collect, why, who can see it, how long we keep it, and your rights.
        </LegalP>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    content: (
      <>
        <LegalP>We collect only what the workspace needs to work:</LegalP>
        <LegalList
          items={[
            <>
              <strong>Account details:</strong> your name, email address, role (Admin, Co-Admin, or Member), and
              committee.
            </>,
            <>
              <strong>Profile photo:</strong> only if you choose to upload one.
            </>,
            <>
              <strong>Sign-in details:</strong> if you use Google, we receive the basic account details Google
              shares for sign-in. If you use a password, it is handled by our sign-in provider and we cannot read
              it.
            </>,
            <>
              <strong>What you add:</strong> events, tasks, comments, event banners, and links to Google Drive
              items.
            </>,
            <>
              <strong>Activity records:</strong> which account created, updated, or deleted something, and when.
            </>,
            <>
              <strong>Notification settings:</strong> your email notification choice and, if you turn on push
              notifications, a technical address for each device you enable.
            </>,
          ]}
        />
        <LegalP>
          We do not ask for your home address, government ID, or payment details, and we do not use advertising or
          tracking tools in the workspace.
        </LegalP>
      </>
    ),
  },
  {
    id: "why-we-use-it",
    title: "Why we use it",
    content: (
      <>
        <LegalP>We use your information only to run the council workspace, which means to:</LegalP>
        <LegalList
          items={[
            "let you sign in and know who you are;",
            "assign and track tasks and events, and show who is responsible for what;",
            "send you notifications about work that involves you;",
            "keep records of changes so the council stays accountable;",
            "keep the system secure and fix problems.",
          ]}
        />
        <LegalP>
          You give your consent when you accept your invitation and use the workspace. We do not sell your
          information, and we do not use it for anything unrelated to the council.
        </LegalP>
      </>
    ),
  },
  {
    id: "who-can-see",
    title: "Who can see your information",
    content: (
      <>
        <LegalP>Access depends on role and is limited by the workspace itself.</LegalP>
        <LegalList
          items={[
            "Other council members can see your name and profile photo where you are assigned or where you comment.",
            "Admins, and Co-Admins for their own committee, can see your email address and role for user management.",
            "Confidential tasks are visible only to people who were given access to them.",
            "Anyone with the direct link to a profile photo or event banner image may be able to open that image.",
          ]}
        />
      </>
    ),
  },
  {
    id: "service-providers",
    title: "Service providers we use",
    content: (
      <>
        <LegalP>
          To run CEIT Connect we rely on trusted providers that handle data for us and only for this purpose:
        </LegalP>
        <LegalList
          items={[
            "our database, sign-in, and file storage provider (Supabase);",
            "Google, if you choose to sign in with Google;",
            "an email delivery service, for important email notifications;",
            "your browser or device's push service, if you turn on push notifications.",
          ]}
        />
        <LegalP>
          These providers may process data on servers outside the Philippines. We do not share your information
          with anyone else unless the law requires it.
        </LegalP>
      </>
    ),
  },
  {
    id: "how-long",
    title: "How long we keep it",
    content: (
      <>
        <LegalList
          items={[
            "The activity log is kept for a period set by the Admins, between 30 and 730 days. The current period is shown at the top of the Activity Log page.",
            "Read notifications are removed automatically after about 60 days. Unread notifications stay until you read or clear them.",
            "Push notification device addresses are removed when you turn push off or when the push service says the device is no longer valid.",
            "Council accounts are deactivated instead of deleted. A former member account can be anonymized, which removes personal details while keeping the council records connected.",
          ]}
        />
        <LegalNote>
          Records kept in backups or required for council accountability may stay for a short time after you ask
          for removal.
        </LegalNote>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    content: (
      <>
        <LegalP>
          Access is limited by role, and the database enforces who can read or change each record. Connections to
          the workspace are encrypted. Only a small number of council officers and builders can administer the
          system.
        </LegalP>
        <LegalP>
          No system is perfectly secure. If a breach affects your personal information in a way that could cause
          you serious harm, we will tell you and the National Privacy Commission as the law requires.
        </LegalP>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    content: (
      <>
        <LegalP>Under the Data Privacy Act, you have the right to:</LegalP>
        <LegalList
          items={[
            "be informed about how your information is used;",
            "ask for a copy of the information we hold about you;",
            "correct information that is wrong or out of date (you can also change your name in Settings);",
            "object to certain uses, or withdraw your consent;",
            "ask us to suspend, remove, or block information that is inaccurate, unlawfully obtained, or no longer needed;",
            "claim compensation if you were harmed by misuse of your data;",
            "receive your information in a commonly used format;",
            "file a complaint with the National Privacy Commission (privacy.gov.ph).",
          ]}
        />
        <LegalP>
          To use any of these rights, contact us using the details below. We will reply as soon as we reasonably
          can.
        </LegalP>
      </>
    ),
  },
  {
    id: "device-storage",
    title: "Cookies and device storage",
    content: (
      <LegalP>
        CEIT Connect uses essential cookies and similar device storage to keep you signed in and to remember
        settings such as light or dark theme and whether the sidebar is collapsed. We do not use advertising
        cookies. You can clear these in your browser, but you may be signed out.
      </LegalP>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    content: (
      <LegalP>
        We may update this policy when the workspace or the law changes. The date at the top of the page shows when
        the current version took effect. If we make an important change, we will tell members in the workspace.
      </LegalP>
    ),
  },
]

export default async function PrivacyPage() {
  const signedIn = await hasSignedInUser()

  return (
    <LegalDocument
      title="Privacy Policy"
      icon={<ShieldCheck />}
      intro="What personal information CEIT Connect collects, why we need it, and how we look after it."
      summary={[
        "We collect only what the workspace needs: your name, email, role, committee, and what you add.",
        "We do not sell your data or use advertising and tracking tools.",
        "Who sees what depends on role, and confidential tasks stay restricted.",
        "Activity and notifications are not kept forever.",
        "You can ask to see, correct, or remove your information at any time.",
        "Follows the Philippine Data Privacy Act of 2012.",
      ]}
      sections={SECTIONS}
      signedIn={signedIn}
      other={{ href: "/terms", label: "Terms of Service" }}
    />
  )
}
