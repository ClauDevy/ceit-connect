import type { Role } from "@/lib/types";

export type HelpManualBlock = {
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
  screenshotLabel?: string;
};

export type HelpManualSection = {
  id: string;
  title: string;
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

export type HelpManualPayload = {
  viewerRole: Role;
  sections: HelpManualSection[];
  faqs: HelpManualFaq[];
  confirmations: string[];
};

const EVERYONE: readonly Role[] = ["Admin", "Co-Admin", "Member"];
const LEADERSHIP: readonly Role[] = ["Admin", "Co-Admin"];

const SECTIONS: readonly HelpManualSection[] = [
  {
    id: "quick-start",
    title: "Quick start",
    summary: "Sign in, set up your account, and find the main parts of CEIT Connect.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "Join and sign in",
        paragraphs: [
          "CEIT Connect is invite-only. Open the invitation sent to your council email, finish the account setup, and then sign in from the login page.",
          "You can use an email link, Google, or your email and password when a password has been set for your account.",
        ],
        bullets: [
          "Forgot your password? Use Forgot password on the login page, enter the code from the reset email, and choose a new password.",
          "Open Settings to set or change your password, update your displayed name, upload or remove your photo, and switch theme.",
        ],
      },
      {
        heading: "Install on a phone",
        bullets: [
          "On iPhone, open CEIT Connect in Safari, use Share, then choose Add to Home Screen.",
          "On Android, open CEIT Connect in Chrome, open the browser menu, then choose Install app or Add to Home screen when offered.",
          "On iPhone, phone notifications are available only from the installed Home Screen app. Open that app before enabling notifications in Settings.",
          "On Android, open Settings in CEIT Connect and choose Enable notifications. The browser permission prompt appears after you choose it.",
        ],
        screenshotLabel: "Phone installation and notification setup",
      },
      {
        heading: "Where things are",
        bullets: [
          "Home lists events you can open.",
          "Tasks contains My Tasks and Help Wanted.",
          "Event Archives contains finished event records.",
          "Settings contains your account, installation, and notification controls.",
          "Help opens this manual. Leadership roles also receive Dashboard, Activity Log, and User Management links.",
        ],
      },
    ],
  },
  {
    id: "your-tasks",
    title: "Your tasks",
    summary: "Read event boards, understand schedules and priority, and work with your team.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "Boards, phases, and task details",
        paragraphs: [
          "An event board is divided into phases and To Do, In Progress, and Completed lanes. It opens on the first phase that is not complete. If every phase is complete, it opens on the first phase.",
          "A completed named phase is locked until authorized leadership reopens it. Unphased work does not complete or lock as a phase.",
        ],
        bullets: [
          "Open a card to see its description, committee, people, schedule, dependency, work links, comments, and available actions.",
          "A Deliverable may have a due date. A Live Operation may have a Duty date, Call time, and optional End time.",
          "A Live Operation is running only while it is between its Call and End times. Its End is used to decide when it is overdue.",
        ],
        screenshotLabel: "Event board and task detail",
      },
      {
        heading: "Priority and deadlines",
        paragraphs: [
          "The priority shown on boards and task lists is the effective priority. It can rise as work approaches its start or becomes overdue without changing the priority originally saved by leadership.",
        ],
        bullets: [
          "Overdue work is shown as Critical.",
          "Low or Medium work can be shown as High when it is running or starts within 24 hours.",
          "My Tasks can sort by closest deadline or effective priority.",
        ],
      },
      {
        heading: "Getting help on a task",
        paragraphs: [
          "A To Do Backlog task can be claimed when the Claim action is available. A task that requests backup appears in Help Wanted for people with access.",
        ],
        bullets: [
          "Members can volunteer to help. Their offer stays pending until authorized leadership or a current primary owner accepts it.",
          "An Admin or Co-Admin who volunteers is added as an assist assignee automatically when the action is allowed.",
          "Current primary owners and authorized leadership can turn a backup request on or off. Turning it off removes pending volunteer offers.",
        ],
      },
      {
        heading: "Work links and comments",
        bullets: [
          "Work links accept supported Google Drive, Docs, Sheets, and Slides links. The file stays in Google Drive; CEIT Connect stores only the link.",
          "A supported link can be opened in Drive and may have an in-page preview.",
          "You can edit your own comment while the task is editable. Delete appears only when the current rules allow it. Archived task comments are read-only.",
        ],
      },
      {
        heading: "Leaving a task",
        paragraphs: [
          "Admins and Co-Admins can leave an active, unfinished task immediately. A Member leaves immediately when there is no deadline or the task starts more than 72 hours away.",
          "At or inside the 72-hour boundary, a Member sends a leave request. The assignment and access stay unchanged until an authorized Admin or the task committee's Co-Admin approves it. The requester may cancel a pending request.",
          "For Live Operations, the 72-hour check uses the start of the operation: Call time first, then an older stored due date when no Call time exists.",
        ],
      },
      {
        heading: "Confidential tasks",
        paragraphs: [
          "Admins and the task committee's Co-Admin have access to confidential task content. Current assignees and people named as additional viewers may also have access.",
          "Other people may see a masked row or no task content, depending on the reader. A masked task never reveals its title or description.",
        ],
      },
    ],
  },
  {
    id: "events",
    title: "Events",
    summary: "Find current events and read permanent archived records.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "Event states",
        bullets: [
          "Draft events are being prepared and are available only through leadership rules.",
          "Active events appear on Home and contain the working task board.",
          "Archived events are permanent, read-only records. Their tasks, work links, and comments cannot be changed.",
        ],
        screenshotLabel: "Home events and Event Archives",
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    summary: "Use the bell for the complete record and phone notifications for short alerts.",
    roles: EVERYONE,
    blocks: [
      {
        heading: "Notification bell",
        paragraphs: [
          "The bell can notify you about mentions, heads-ups, assignments, status changes, unlocked tasks, backup requests, volunteer offers, leave requests and decisions, due-soon tasks, and Live Operation preparation.",
        ],
        bullets: [
          "Open a row to mark it read and go to its available task or comment target.",
          "You can delete one notification or use Clear read to remove read notifications. Unread notifications are not cleared by that action.",
          "Due-soon reminders are created for assigned, unfinished tasks in Active events when a stored due date enters the next 24 hours.",
          "Live Operation prep reminders are created when an assigned, unfinished Live Operation in an Active event has a Call time within the next two hours. An End time does not create a reminder.",
        ],
      },
      {
        heading: "Grouped phone alerts",
        paragraphs: [
          "Every bell row remains separate. Only certain phone alerts are briefly held so several alerts of the same kind can become one counts-only phone message.",
        ],
        bullets: [
          "Launch assignments, due-soon reminders, Live Operation prep reminders, and unlock bursts may group.",
          "New alerts can join the group for 25 seconds, and delivery becomes ready at 30 seconds.",
          "A group says how many tasks are involved and does not include task titles. Open the bell to see the individual rows.",
        ],
        screenshotLabel: "Notification bell and phone alerts",
      },
    ],
  },
  {
    id: "leadership",
    title: "Co-Admin and Admin only",
    summary: "Create and manage work within the authority attached to your role.",
    roles: LEADERSHIP,
    blocks: [
      {
        heading: "Role and committee boundaries",
        paragraphs: [
          "Admins can manage work across committees. Co-Admins manage task and member changes for their own committee unless a specific reader gives broader read-only access.",
          "Non-Admins cannot be newly assigned to the President committee. Existing assignments stay unchanged.",
        ],
        bullets: [
          "Admins can invite officers, move Members between committees, manage another eligible account's active state, and anonymize eligible former members.",
          "Co-Admins can view, invite, deactivate, and reactivate Members in their own committee. They cannot manage officers or move people between committees.",
          "The Executive Dashboard and Activity Log are available to Admins and Co-Admins. Co-Admin dashboard data stays within their committee; Admins receive council-wide and Admin-only views.",
        ],
      },
      {
        heading: "Create and edit work",
        bullets: [
          "Admins can create and edit tasks for any committee. Co-Admins can write tasks only for their current committee.",
          "Choose today or a later date when adding or changing a date on an Active-event task. An older date already stored on a task may stay unchanged.",
          "For a Live Operation, Due date is hidden. Leave End date blank when it finishes on the Duty date; use End date only for an overnight operation.",
          "The Admin committee picker starts blank. A Co-Admin's committee is derived from their account.",
          "Newer Live Operations have no due date. Older ones may still show one and may send a due-soon reminder.",
        ],
      },
      {
        heading: "Events and templates",
        bullets: [
          "Draft tasks are edited through Edit Event. Active tasks are added or edited from the board or task page. Archived work is read-only.",
          "Launching requires a named event with dates and at least one valid task. A completely unscheduled Live Operation is allowed, but it has no timing escalation or prep reminder until a Call time is added.",
          "Tasks imported from an archived template start with blank due, call, and end schedules. Review and set any schedule needed for the new event.",
          "Named completed phases lock their tasks. Authorized leadership can reopen a phase by returning one task to In Progress.",
        ],
        screenshotLabel: "Leadership event and task setup",
      },
      {
        heading: "Requests, dashboard, and history",
        bullets: [
          "Authorized Admins and the task committee's Co-Admin can approve or deny Member leave requests. A requester cannot resolve their own request.",
          "Volunteer offers can be accepted by authorized leadership or a current primary owner, but nobody can accept their own offer.",
          "The Executive Dashboard separates overdue, due within 24 hours, at-risk, running, and other work using the task's effective timing.",
          "Activity Log entries are kept for 30 days. Confidential task information remains masked when the viewer lacks access.",
        ],
      },
      {
        heading: "Deactivation and former-member removal",
        paragraphs: [
          "Deactivation blocks normal access but does not delete the account or rewrite its historical references.",
          "Admin-only former-member removal anonymizes an eligible deactivated account instead of deleting it. Accounts still assigned to open Draft or Active tasks are skipped. Archived assignments and historical comments remain attached to the same internal identity.",
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
      "Check that you are using the invited email address. Try the email-link or Google option shown on Login, or use your password if you have set one. A deactivated account cannot enter the app.",
    ],
    roles: EVERYONE,
  },
  {
    id: "forgot-password",
    question: "I forgot my password.",
    answer: [
      "Choose Forgot password on the login page, enter your invited email, then use the code from the reset email to choose a new password.",
    ],
    roles: EVERYONE,
  },
  {
    id: "task-visibility",
    question: "Why can't I see a task my friend sees?",
    answer: [
      "The task may be confidential, Draft-only, or outside the access attached to your role and committee. Confidential task details are limited to authorized leadership, assignees, and additional viewers.",
    ],
    roles: EVERYONE,
  },
  {
    id: "claim-and-assign",
    question: "Who can claim a task, and who can assign one?",
    answer: [
      "An active person with access can claim an eligible To Do Backlog task when Claim is shown. Assignment controls appear only for authorized leadership and other capability-approved task owners.",
    ],
    roles: EVERYONE,
  },
  {
    id: "comments",
    question: "Can I edit or delete my comment?",
    answer: [
      "You can edit your own comment while the task is editable. Delete appears only when the current task and comment rules allow it. Archived task comments are always read-only.",
    ],
    roles: EVERYONE,
  },
  {
    id: "phone-notifications",
    question: "How do I turn on notifications on my phone?",
    answer: [
      "On Android, open CEIT Connect in Chrome and use Enable notifications in Settings. On iPhone, add CEIT Connect to the Home Screen from Safari, open the installed app, then enable notifications in Settings.",
    ],
    roles: EVERYONE,
  },
  {
    id: "notifications-stopped",
    question: "Why did I stop getting notifications?",
    answer: [
      "Open Settings on that device and check the notification status. Browser permission changes, removing the saved device, or a replaced browser subscription can require you to enable notifications again.",
    ],
    roles: EVERYONE,
  },
  {
    id: "effective-priority",
    question: "Why did my task show a higher priority than I set?",
    answer: [
      "CEIT Connect displays effective priority on task lists and boards. It can rise when work is running, starts within 24 hours, or is overdue without changing the saved priority.",
    ],
    roles: EVERYONE,
  },
  {
    id: "leave-task",
    question: "Why can't I leave a task right away?",
    answer: [
      "Members need approval when the task starts at or inside the next 72 hours. Your assignment remains until leadership approves the request. Admins and Co-Admins leave immediately.",
    ],
    roles: EVERYONE,
  },
  {
    id: "grouped-notification",
    question: "Why did I get one notification for several tasks?",
    answer: [
      "Some same-kind phone alerts wait briefly and use one counts-only message. The bell still keeps a separate row for every task.",
    ],
    roles: EVERYONE,
  },
  {
    id: "removed-account",
    question: "What happens to my tasks if I'm removed from the organization?",
    answer: [
      "Deactivation blocks access but preserves task and event history. An eligible former account may later be anonymized, but historical references remain and open task assignments must be resolved first.",
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

const CONFIRMATIONS = [
  "Who should users contact when something is broken? The owner will add the approved contact destination later.",
  "What single recovery step should be recommended when a saved name or photo does not appear everywhere?",
] as const;

export function getHelpManualForRole(role: Role): HelpManualPayload {
  return {
    viewerRole: role,
    sections: SECTIONS.filter((section) => section.roles.includes(role)).map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({ ...block })),
    })),
    faqs: FAQS.filter((faq) => faq.roles.includes(role)).map((faq) => ({ ...faq })),
    confirmations: [...CONFIRMATIONS],
  };
}

