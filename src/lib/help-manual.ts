import type { Role } from "@/lib/types";
import { COUNCIL_CONTACT } from "@/lib/council-info";

/**
 * Which little drawing a block shows (see `components/help/help-illustrations.tsx`).
 * These replace the old grey "Screenshot coming later" boxes.
 */
export type HelpIllustrationId = "phone" | "board" | "events" | "bell" | "leadership";

/**
 * Text fields may wrap a key word in **double asterisks** to show it in bold.
 * The Help screen turns those into bold text; search ignores the asterisks.
 */
export type HelpManualBlock = {
  heading: string;
  paragraphs?: readonly string[];
  /** A plain checklist-style list. */
  bullets?: readonly string[];
  /** A numbered "do this, then this" list. */
  steps?: readonly string[];
  /** A "word → meaning" list. */
  glossary?: readonly { term: string; meaning: string }[];
  /** A highlighted "Good to know" note. */
  tip?: string;
  illustration?: HelpIllustrationId;
};

export type HelpManualSection = {
  id: string;
  title: string;
  /** Two or three words shown on the topic tile. */
  blurb: string;
  summary: string;
  roles: readonly Role[];
  blocks: readonly HelpManualBlock[];
};

export type HelpManualFaq = {
  id: string;
  question: string;
  answer: readonly string[];
  roles: readonly Role[];
};

export type HelpContactChannel = {
  id: "email" | "facebook" | "office";
  label: string;
  value: string;
  note: string;
  /** Makes the card tappable: a mailto: or https link. Omit for the office address. */
  href?: string;
};

export type HelpContact = {
  summary: string;
  channels: readonly HelpContactChannel[];
  tip: string;
};

export type HelpManualPayload = {
  viewerRole: Role;
  sections: HelpManualSection[];
  faqs: HelpManualFaq[];
  contact: HelpContact;
};

const EVERYONE: readonly Role[] = ["Admin", "Co-Admin", "Member"];
const LEADERSHIP: readonly Role[] = ["Admin", "Co-Admin"];

const SECTIONS: readonly HelpManualSection[] = [
  {
    id: "quick-start",
    title: "Quick start",
    blurb: "Sign in and get set up",
    summary: "Sign in, set up your account, and find your way around CEIT Connect.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "Join and sign in",
        paragraphs: [
          "CEIT Connect is **invite-only**. Open the invitation sent to your council email, finish setting up your account, then sign in from the login page.",
          "You can sign in with an **email link**, with **Google**, or with your **email and password** (if you have set a password).",
        ],
        bullets: [
          "Forgot your password? Tap **Forgot password** on the login page, type the code from the reset email, then choose a new password.",
          "Open **Settings** to set or change your password, change your name, add or remove your photo, and switch between light and dark.",
        ],
      },
      {
        heading: "Put CEIT Connect on your phone",
        paragraphs: [
          "Installing the app puts an icon on your home screen, so it opens like any other app. On iPhone, you must do this to get phone notifications.",
        ],
        illustration: "phone",
      },
      {
        heading: "On an iPhone (Safari)",
        steps: [
          "Open CEIT Connect in **Safari**.",
          "Tap the **Share** button.",
          "Choose **Add to Home Screen**.",
          "Open CEIT Connect from its new icon on your Home Screen.",
        ],
        tip: "iPhones only allow notifications from the installed Home Screen app. Open that app first, then turn on notifications in Settings.",
      },
      {
        heading: "On an Android phone (Chrome)",
        steps: [
          "Open CEIT Connect in **Chrome**.",
          "Tap the browser menu (the three dots).",
          "Choose **Install app** or **Add to Home screen** when it is offered.",
          "To get alerts, open **Settings** in CEIT Connect and tap **Enable notifications**. Your phone will then ask for permission.",
        ],
      },
      {
        heading: "Where to find things",
        bullets: [
          "**Home** — the events you can open.",
          "**Tasks** — two tabs: My Tasks and Help Wanted.",
          "**Event Archives** — finished events you can still read.",
          "**Settings** — your account, app installation, and notification controls.",
          "**Help** — this guide.",
          "Admins and Co-Admins also see **Dashboard**, **Activity Log** and **User Management**.",
        ],
      },
    ],
  },
  {
    id: "words",
    title: "Words you'll see",
    blurb: "Plain-English meanings",
    summary: "Short, simple meanings for the words used around the app.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "Quick dictionary",
        glossary: [
          { term: "Event", meaning: "A project or activity the council is organizing. Each event has its own board." },
          { term: "Board", meaning: "The page that shows all the tasks of one event, laid out in columns." },
          { term: "Phase", meaning: "A stage of an event. Tasks on a board are grouped by phase." },
          { term: "Lanes", meaning: "The three columns on a board: To Do, In Progress and Completed." },
          { term: "Deliverable", meaning: "A task with something to finish. It can have a due date." },
          { term: "Live Operation", meaning: "A task for the day itself. It can have a Duty date, a Call time and an End time." },
          { term: "Call time", meaning: "The time a Live Operation starts." },
          { term: "Claim", meaning: "Take an open task for yourself, so you become its owner." },
          { term: "Help Wanted", meaning: "A list of tasks whose owner asked for backup." },
          { term: "Committee", meaning: "The council team that a task or a person belongs to." },
          { term: "Effective priority", meaning: "The priority you see on a task. It can rise when a deadline gets close." },
          { term: "Archived", meaning: "Finished and saved for good. You can read it, but not change it." },
        ],
      },
    ],
  },
  {
    id: "your-tasks",
    title: "Your tasks",
    blurb: "Boards, deadlines and teamwork",
    summary: "Read event boards, understand deadlines and priority, and work with your team.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "Event boards",
        paragraphs: [
          "Every event has a **board**. The board is split into **phases** (the stages of the event). Inside each phase, tasks sit in three lanes: **To Do**, **In Progress** and **Completed**.",
          "The board opens on the first phase that is not finished yet. If every phase is finished, it opens on the first one.",
        ],
        illustration: "board",
        bullets: [
          "Tap a card to see its description, committee, people, schedule, links, comments, and the actions you can take.",
          "A **Deliverable** can have a due date.",
          "A **Live Operation** can have a Duty date, a Call time and an optional End time.",
          "A Live Operation is **running** only between its Call time and its End time. The End time is what decides when it becomes overdue.",
        ],
        tip: "When every task in a named phase is finished, that phase is locked. Authorized leaders can reopen it. Tasks that are not in any phase never lock.",
      },
      {
        heading: "Priority and deadlines",
        paragraphs: [
          "The priority you see on boards and task lists is the **effective priority**. It can go up as a deadline gets close, even though the priority your leaders originally saved does not change.",
        ],
        bullets: [
          "Overdue work shows as **Critical**.",
          "Low or Medium work shows as **High** when it is running or starts within 24 hours.",
          "On **My Tasks**, you can sort by closest deadline or by priority.",
        ],
      },
      {
        heading: "Getting help on a task",
        paragraphs: [
          "If a task in the **To Do Backlog** has a **Claim** button, you can take it. If a task owner asks for backup, the task appears in **Help Wanted** for people who have access.",
        ],
        bullets: [
          "Members can **volunteer** to help. Your offer stays pending until an authorized leader or the task's main owner accepts it.",
          "If an Admin or Co-Admin volunteers, they are added as a helper automatically (when allowed).",
          "The main owner and authorized leaders can turn **backup requests** on or off. Turning it off removes any pending offers.",
        ],
      },
      {
        heading: "Work links and comments",
        bullets: [
          "You can add links to Google **Drive**, **Docs**, **Sheets** or **Slides**. The file stays in Google Drive. CEIT Connect only saves the link.",
          "A supported link can be opened in Drive, and some show a preview right on the page.",
          "You can edit your own comment while the task can still be edited. The **Delete** button only appears when the rules allow it.",
          "Comments on archived tasks are read-only.",
        ],
      },
      {
        heading: "Leaving a task",
        paragraphs: [
          "**Admins and Co-Admins** can leave an active, unfinished task right away.",
          "**Members** can leave right away when the task has no deadline, or starts more than 72 hours (3 days) away.",
          "If the task starts in 72 hours or less, a Member sends a **leave request** instead. You stay assigned, and keep your access, until an authorized Admin (or the Co-Admin of the task's committee) approves it. You can cancel a pending request.",
        ],
        tip: "For Live Operations, the 72 hours are counted from the start: the Call time first, or an older saved due date if there is no Call time.",
      },
      {
        heading: "Confidential tasks",
        paragraphs: [
          "Admins and the Co-Admin of the task's committee can see everything in a confidential task. The people assigned to it, and anyone added as an extra viewer, may see it too.",
          "Everyone else may see a hidden row or nothing at all. A hidden task never shows its title or description.",
        ],
      },
    ],
  },
  {
    id: "events",
    title: "Events",
    blurb: "Draft, Active and Archived",
    summary: "Find current events and read the permanent records of finished ones.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "The three event states",
        illustration: "events",
        bullets: [
          "**Draft** — an event that is still being prepared. Only leaders can work with it.",
          "**Active** — shows on Home and holds the working task board.",
          "**Archived** — a permanent, read-only record. Its tasks, work links and comments cannot be changed.",
        ],
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    blurb: "The bell and phone alerts",
    summary: "The bell keeps the full list. Phone alerts are short reminders.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "The notification bell",
        paragraphs: [
          "The bell tells you about mentions, heads-ups, new assignments, status changes, unlocked tasks, backup requests, volunteer offers, leave requests and their decisions, tasks due soon, and Live Operation preparation.",
        ],
        illustration: "bell",
        bullets: [
          "Tap a row to mark it read and go to its task or comment.",
          "You can delete one notification, or tap **Clear read** to remove all the ones you have read. Unread notifications are not cleared.",
          "**Due-soon reminder:** you get one for an assigned, unfinished task in an Active event when its due date is within the next 24 hours.",
          "**Live Operation prep reminder:** you get one when an assigned, unfinished Live Operation in an Active event has a Call time within the next 2 hours. An End time does not create a reminder.",
        ],
      },
      {
        heading: "Grouped phone alerts",
        paragraphs: [
          "Every task still gets its own row in the bell. But some phone alerts wait a moment, so several of the same kind can arrive as **one message**.",
        ],
        bullets: [
          "Alerts that may be grouped: new launch assignments, due-soon reminders, Live Operation prep reminders, and unlocked tasks.",
          "New alerts can join a group for 25 seconds. The phone message is ready to send at 30 seconds.",
          "A grouped message only tells you **how many** tasks are involved, not their titles. Open the bell to see each one.",
        ],
      },
    ],
  },
  {
    id: "leadership",
    title: "Co-Admin and Admin only",
    blurb: "Tools for leaders",
    summary: "Create and manage work within the limits of your role.",
    roles: LEADERSHIP,
    blocks: [
      {
        heading: "What each role can do",
        paragraphs: [
          "**Admins** can manage work across all committees. **Co-Admins** manage tasks and members for their **own committee**, unless a specific page gives them wider read-only access.",
          "Only Admins can be newly assigned to the President committee. Existing assignments stay unchanged.",
        ],
        illustration: "leadership",
        bullets: [
          "Admins can invite officers, move Members between committees, turn another eligible account on or off, and anonymize eligible former members.",
          "Co-Admins can view, invite, deactivate and reactivate Members in their own committee. They cannot manage officers or move people between committees.",
          "The **Executive Dashboard** is for Admins and Co-Admins. A Co-Admin's dashboard only shows data for their own committee. Admins see council-wide and Admin-only views.",
          "The **Activity Log** is for active Admins and Co-Admins. They see the whole log, and any task details they are not allowed to see are hidden (masked).",
        ],
      },
      {
        heading: "Create and edit work",
        bullets: [
          "Admins can create and edit tasks for any committee. Co-Admins can only write tasks for their own committee.",
          "When you add or change a date on an Active-event task, choose today or a later date. An older date that is already saved can stay as it is.",
          "For a **Live Operation**, the Due date is hidden. Leave **End date** blank if it finishes on the Duty date. Use End date only for an overnight operation.",
          "The Admin committee picker starts blank. A Co-Admin's committee is filled in from their account.",
          "Newer Live Operations have no due date. Older ones may still show one, and may still send a due-soon reminder.",
        ],
      },
      {
        heading: "Events and templates",
        bullets: [
          "Edit tasks of a **Draft** event through **Edit Event**. Add or edit tasks of an **Active** event from the board or the task page. Archived work is read-only.",
          "To **launch** an event, it needs a name, dates, and at least one valid task. A Live Operation with no schedule at all is allowed, but it gets no timing escalation or prep reminder until you add a Call time.",
          "Tasks imported from an archived template start with **blank** due, call and end times. Check them and set any schedule the new event needs.",
          "Finished named phases lock their tasks. Authorized leaders can reopen a phase by moving one of its tasks back to In Progress.",
        ],
      },
      {
        heading: "Requests, dashboard and history",
        bullets: [
          "Authorized Admins and the task committee's Co-Admin can approve or deny a Member's leave request. Nobody can resolve their own request.",
          "A volunteer offer can be accepted by an authorized leader or the task's main owner, but nobody can accept their own offer.",
          "The Executive Dashboard separates overdue work, work due within 24 hours, at-risk work, running work, and everything else, using each task's effective timing.",
          "Activity Log entries are kept for **30 days**. Confidential task information stays hidden from anyone without access.",
        ],
      },
      {
        heading: "Deactivating and removing former members",
        paragraphs: [
          "**Deactivating** an account blocks its access, but does not delete the account or change its history.",
          "**Removing a former member** (Admins only) anonymizes an eligible deactivated account instead of deleting it. Accounts that are still assigned to open Draft or Active tasks are skipped. Archived assignments and old comments stay attached to the same account.",
        ],
      },
    ],
  },
];

const FAQS: readonly HelpManualFaq[] = [
  {
    id: "login",
    question: "I can't log in. What do I do?",
    answer: [
      "Check that you are using the email address you were invited with. Try the email-link or Google option on the login page, or use your password if you have set one. A deactivated account cannot enter the app.",
    ],
    roles: EVERYONE,
  },
  {
    id: "forgot-password",
    question: "I forgot my password.",
    answer: [
      "Tap **Forgot password** on the login page and enter your invited email. Then type the code from the reset email and choose a new password.",
    ],
    roles: EVERYONE,
  },
  {
    id: "install-app",
    question: "How do I install CEIT Connect on my phone?",
    answer: [
      "On iPhone, open CEIT Connect in Safari, tap Share, then choose Add to Home Screen. On Android, open it in Chrome, tap the menu, then choose Install app or Add to Home screen.",
    ],
    roles: EVERYONE,
  },
  {
    id: "change-name-photo",
    question: "How do I change my name, photo or password?",
    answer: [
      "Open **Settings**. You can update your displayed name, upload or remove your photo, set or change your password, and switch between light and dark.",
    ],
    roles: EVERYONE,
  },
  {
    id: "name-photo-not-updating",
    question: "I changed my name or photo, but the old one still shows.",
    answer: [
      "Refresh the page, or sign out and sign back in. If the old name or photo is still showing after that, contact us using the details in the **Contact us** section.",
    ],
    roles: EVERYONE,
  },
  {
    id: "task-visibility",
    question: "Why can't I see a task my friend sees?",
    answer: [
      "The task may be confidential, still a Draft, or outside the access that comes with your role and committee. Confidential task details are only shown to authorized leaders, the people assigned to the task, and extra viewers.",
    ],
    roles: EVERYONE,
  },
  {
    id: "claim-and-assign",
    question: "Who can claim a task, and who can assign one?",
    answer: [
      "Any active person with access can claim an open To Do Backlog task when the Claim button is shown. The controls for assigning people only appear for authorized leaders and other approved task owners.",
    ],
    roles: EVERYONE,
  },
  {
    id: "comments",
    question: "Can I edit or delete my comment?",
    answer: [
      "You can edit your own comment while the task can still be edited. The Delete button only appears when the rules allow it. Comments on archived tasks are always read-only.",
    ],
    roles: EVERYONE,
  },
  {
    id: "phone-notifications",
    question: "How do I turn on notifications on my phone?",
    answer: [
      "On Android, open CEIT Connect in Chrome and tap Enable notifications in Settings. On iPhone, add CEIT Connect to your Home Screen from Safari, open the installed app, then turn on notifications in Settings.",
    ],
    roles: EVERYONE,
  },
  {
    id: "notifications-stopped",
    question: "Why did I stop getting notifications?",
    answer: [
      "Open Settings on that device and check the notification status. If you changed the browser permission, removed the saved device, or the browser replaced its subscription, you may need to turn notifications on again.",
    ],
    roles: EVERYONE,
  },
  {
    id: "effective-priority",
    question: "Why did my task show a higher priority than I set?",
    answer: [
      "CEIT Connect shows the effective priority on task lists and boards. It can rise when work is running, starts within 24 hours, or is overdue. The priority that was saved does not change.",
    ],
    roles: EVERYONE,
  },
  {
    id: "leave-task",
    question: "Why can't I leave a task right away?",
    answer: [
      "Members need approval when a task starts in 72 hours or less. You stay assigned until a leader approves your request. Admins and Co-Admins can leave right away.",
    ],
    roles: EVERYONE,
  },
  {
    id: "grouped-notification",
    question: "Why did I get one notification for several tasks?",
    answer: [
      "Some phone alerts of the same kind wait a moment and arrive as one message that only shows a count. The bell still keeps a separate row for every task.",
    ],
    roles: EVERYONE,
  },
  {
    id: "removed-account",
    question: "What happens to my tasks if I'm removed from the organization?",
    answer: [
      "Deactivating an account blocks access but keeps the task and event history. An eligible former account may later be anonymized, but its history stays, and any open task assignments must be sorted out first.",
    ],
    roles: EVERYONE,
  },
  {
    id: "activity-retention",
    question: "How long does the Activity Log keep entries?",
    answer: ["Activity Log entries are kept for 30 days."],
    roles: LEADERSHIP,
  },
  {
    id: "president-committee",
    question: "Who can be newly assigned to the President committee?",
    answer: [
      "Only Admins can be newly assigned. Existing assignments stay unchanged.",
    ],
    roles: LEADERSHIP,
  },
];

const CONTACT: HelpContact = {
  summary: "Still stuck? Reach out and a real person from the council will help you.",
  channels: [
    {
      id: "email",
      label: "Email",
      value: COUNCIL_CONTACT.email,
      note: "Best for questions that are not urgent.",
      href: `mailto:${COUNCIL_CONTACT.email}`,
    },
    {
      id: "facebook",
      label: "Facebook page",
      value: "Message the CEIT Student Council",
      note: "Good for quick questions.",
      href: COUNCIL_CONTACT.facebookUrl,
    },
    {
      id: "office",
      label: "Visit us",
      value: COUNCIL_CONTACT.office,
      note: "Drop by and talk to the team in person.",
    },
  ],
  tip: "When you write to us, tell us your name, your committee, and what you were doing when it went wrong. A screenshot helps a lot.",
};

export function getHelpManualForRole(role: Role): HelpManualPayload {
  return {
    viewerRole: role,
    sections: SECTIONS.filter((section) => section.roles.includes(role)).map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({ ...block })),
    })),
    faqs: FAQS.filter((faq) => faq.roles.includes(role)).map((faq) => ({ ...faq })),
    contact: { ...CONTACT, channels: CONTACT.channels.map((channel) => ({ ...channel })) },
  };
}
