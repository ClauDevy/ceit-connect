import type { Metadata } from "next"
import { FileText } from "lucide-react"
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
  title: "Terms of Service | CEIT Connect",
  description: "The rules for using CEIT Connect, the CEIT Student Council workspace.",
}

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    content: (
      <>
        <LegalP>
          CEIT Connect is the task and event workspace of the {COUNCIL_CONTACT.organization} of{" "}
          {COUNCIL_CONTACT.institution}. These Terms of Service explain the rules for using it. By signing in
          or using CEIT Connect, you agree to them.
        </LegalP>
        <LegalP>
          If you do not agree, please do not use the workspace and let the council know. How we handle your
          personal data is explained separately in our Privacy Policy.
        </LegalP>
      </>
    ),
  },
  {
    id: "who-can-use",
    title: "Who can use CEIT Connect",
    content: (
      <>
        <LegalP>
          CEIT Connect is an invite-only workspace for the CEIT Student Council. You can use it only if the
          council has invited you and your account is active. Invited accounts can sign in with an email link,
          Google, or a password.
        </LegalP>
        <LegalP>
          Your account is personal. Please do not share it, and do not sign in as someone else.
        </LegalP>
      </>
    ),
  },
  {
    id: "your-account",
    title: "Keeping your account safe",
    content: (
      <LegalList
        items={[
          "Choose a password that is hard to guess and is not used on other sites.",
          "Sign out on shared or public computers.",
          "Tell the council quickly if you think someone else has used your account.",
          "You are responsible for what is done through your account.",
        ]}
      />
    ),
  },
  {
    id: "roles",
    title: "Roles and what you can see",
    content: (
      <>
        <LegalP>
          The workspace has three roles: Admin, Co-Admin, and Member. What you can see and do depends on your
          current role, your committee, and the access given on each task.
        </LegalP>
        <LegalP>
          Some tasks can be marked confidential. If a task is confidential and you do not have access, you will
          see limited information or nothing at all. Do not try to work around these limits or look at things you
          were not given access to.
        </LegalP>
      </>
    ),
  },
  {
    id: "using-workspace",
    title: "Using the workspace",
    content: (
      <>
        <LegalP>
          The workspace supports council events, tasks, comments, notifications, and task access controls. Please
          use it for council work only, and use it respectfully.
        </LegalP>
        <LegalP>You agree not to:</LegalP>
        <LegalList
          items={[
            "harass, threaten, or bully anyone, including in comments;",
            "post someone else's private information without their permission;",
            "upload or link anything illegal, harmful, or that you do not have the right to share;",
            "try to break, overload, or get around the security or access rules of the system;",
            "use the workspace for personal business, advertising, or anything unrelated to the council.",
          ]}
        />
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content and links",
    content: (
      <>
        <LegalP>
          You are responsible for the events, tasks, comments, profile photos, and event banners you add. Because
          this is council work, you allow the council to store, show, and keep using it for council purposes,
          including after you leave, so past events and tasks stay complete. Your profile photo and personal
          details are handled as described in the Privacy Policy.
        </LegalP>
        <LegalP>
          Google Drive items added to tasks are saved as links. CEIT Connect does not upload the linked Drive
          files into the task record. Who can open a file is still controlled by its Google Drive sharing
          settings, so please check them before you add the link.
        </LegalP>
      </>
    ),
  },
  {
    id: "records",
    title: "Council records",
    content: (
      <LegalP>
        To keep the council accountable, the workspace records important changes, such as who created, updated, or
        deleted a task or event, and when. These records are visible to people with the right role and are used
        only for council work and for sorting out mistakes or disputes.
      </LegalP>
    ),
  },
  {
    id: "notifications",
    title: "Notifications",
    content: (
      <LegalP>
        CEIT Connect shows notifications inside the app and can send important email notifications. Push
        notifications are optional and are enabled per device. They can be managed from Settings on that device.
      </LegalP>
    ),
  },
  {
    id: "account-changes",
    title: "Account changes and removal",
    content: (
      <>
        <LegalP>
          Council accounts are deactivated instead of deleted. A former member account can be anonymized while
          keeping its existing identifier connected to council records, so past events and tasks still make sense.
        </LegalP>
        <LegalP>
          The council may deactivate or limit an account if its owner is no longer part of the council, or if
          these terms are broken.
        </LegalP>
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes to the service",
    content: (
      <>
        <LegalP>
          CEIT Connect is built and run by students for the council. We try to keep it working, but we cannot
          promise it will always be available or free of mistakes. Features may change, and we may pause the
          service for maintenance.
        </LegalP>
        <LegalNote>
          Keep your own copy of anything critical, such as final event documents, outside the workspace.
        </LegalNote>
      </>
    ),
  },
  {
    id: "liability",
    title: "Limits of responsibility",
    content: (
      <LegalP>
        CEIT Connect is provided &ldquo;as is&rdquo;. To the extent allowed by Philippine law, the council and the
        people who built the workspace are not responsible for losses that come from using it, such as a missed
        deadline caused by an outage or a notification that did not arrive. Nothing in these terms limits any
        right you have under the law that cannot be limited.
      </LegalP>
    ),
  },
  {
    id: "ownership",
    title: "Ownership of the app",
    content: (
      <LegalP>
        The CEIT Connect software, design, name, logo, and mascot belong to the CEIT Student Council and its
        builders. The names and marks of Cavite State University belong to the university. Please do not copy or
        reuse them outside council work without permission.
      </LegalP>
    ),
  },
  {
    id: "changes-governing-law",
    title: "Changes and governing law",
    content: (
      <>
        <LegalP>
          We may update these terms when the workspace or the rules change. The date at the top of this page shows
          when the current version took effect. If we make an important change, we will let members know in the
          workspace. Using CEIT Connect after a change means you accept the updated terms.
        </LegalP>
        <LegalP>These terms are governed by the laws of the Republic of the Philippines.</LegalP>
      </>
    ),
  },
]

export default async function TermsPage() {
  const signedIn = await hasSignedInUser()

  return (
    <LegalDocument
      title="Terms of Service"
      icon={<FileText />}
      intro="The simple rules for using the CEIT Student Council workspace, written to be easy to read."
      summary={[
        "CEIT Connect is invite-only, for council members.",
        "Your account is yours alone. Keep it safe and do not share it.",
        "Use the workspace respectfully and only for council work.",
        "Confidential tasks stay confidential. Do not go around access limits.",
        "Accounts are deactivated, not deleted, so council records stay complete.",
        "The service is student-run and provided as is.",
      ]}
      sections={SECTIONS}
      signedIn={signedIn}
      other={{ href: "/privacy", label: "Privacy Policy" }}
    />
  )
}
