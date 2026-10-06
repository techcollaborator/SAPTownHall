/**
 * Prompt banks for an SAP practice town hall.
 *
 * Sizing: with 5 to a team, 100 people make 20 teams, so each round is 10 head-to-head
 * matchups and needs 10 prompts. A 3-round game uses 21 (10 + 10 + the grand final);
 * a 5-round game uses 41. The 140 below cover several town halls with no repeats.
 *
 * House style, so nothing lands badly on a big screen in front of the whole practice:
 *   - Aim at systems, process and jargon we all share — never at a person, a team,
 *     a named customer, or anything to do with pay, reviews or headcount.
 *   - Affectionate, not bitter. The room should laugh at itself, together.
 *   - Write <BLANK> anywhere you want a fill-in-the-blank slot on screen.
 *
 * Swap in your own via prompts.custom.json or the host screen — see the README.
 */

export const MAIN_PROMPTS = [
  // ── SAP, lightly ──────────────────────────────────────────────────────────
  "If SAP stood for three honest words, they would be…",
  "A transaction code that should exist but doesn't…",
  "How you'd explain S/4HANA to your grandmother in one sentence…",
  "A Fiori tile nobody asked for…",
  "What 'standard functionality' means once the business sees it…",
  "A realistic error message to ship instead of 'An error occurred'…",
  "The real reason nobody will touch that report from 2011…",
  "A new SAP module the business desperately needs…",
  "The real difference between a workaround and a solution…",
  "A brand-new certification the world is waiting for: Certified <BLANK>",
  "The polite way to say 'that is not what the system does'…",
  "A screen that hasn't changed since 1998 and still works perfectly…",
  "What the loading spinner is actually doing while you wait…",
  "The most optimistic sentence in any architecture document…",
  "A dialog box that would genuinely improve your day…",

  // ── Projects, plans and status ────────────────────────────────────────────
  "The most dangerous sentence in a project status deck…",
  "What amber status actually means…",
  "The real definition of scope creep, in one sentence…",
  "A change request nobody will approve but everyone will implement…",
  "What the project plan says versus what the project does…",
  "The true purpose of the RAID log…",
  "A milestone name that should be banned…",
  "What 'we're tracking to plan' translates to…",
  "The one slide reused in every steering committee since kickoff…",
  "A realistic name for phase 2…",
  "What happens to the risk register after week three…",
  "How the estimate was really produced…",
  "A dependency nobody wrote down…",
  "The bravest number in the business case…",
  "What 'minimum viable' turned out to mean…",
  "A lessons-learned entry that appears at the end of every single project…",
  "A project codename that gave away far too much…",
  "What the burndown chart is actually burning…",
  "The real reason that decision keeps getting deferred…",
  "A deadline that was always going to move, announced as <BLANK>",

  // ── Go-live, cutover, hypercare ───────────────────────────────────────────
  "You know it's cutover weekend when…",
  "The most terrifying four words to hear at 2am on go-live night…",
  "What's actually in the go-live war room besides laptops…",
  "A hypercare ticket title that tells you everything…",
  "The go-live checklist item everyone pretends to have done…",
  "What 'we'll fix it in hypercare' really means…",
  "The unofficial mascot of a cutover weekend…",
  "How the team celebrates a clean go-live…",
  "The bravest thing anyone has said on a cutover call…",
  "The first thing that breaks five minutes after go-live…",
  "What the dress rehearsal conveniently leaves out…",
  "The real unit of measurement for a cutover: not hours, but <BLANK>",
  "The real reason that transport is still sitting in QA…",
  "What happens to anything released on a Friday afternoon…",
  "What 'it works in the test system' is worth, in cash…",

  // ── Data and testing ──────────────────────────────────────────────────────
  "The number one law of data migration, learned the hard way…",
  "What the old data actually looks like once you open it…",
  "A customer record that should not legally exist…",
  "The most creative thing someone has typed into a mandatory field…",
  "A data quality issue that has quietly become a business process…",
  "The real reason the numbers don't add up…",
  "What 'cleansed data' means in practice…",
  "What UAT really stands for by day three…",
  "A test script step that everyone skips…",
  "What a tester means by 'it works on my machine'…",
  "The most suspicious thing about a fully green test report…",
  "A defect closed as 'works as designed', which actually means…",
  "The one scenario nobody thought to test…",
  "The least helpful thing a user can write in a bug report…",
  "A field the business swore was mandatory, now containing…",

  // ── Support, tickets and the help desk ────────────────────────────────────
  "A ticket description consisting of the single word 'broken', about…",
  "The most honest possible service-level agreement…",
  "What 'have you tried logging out and back in' really means…",
  "The real reason that urgent call has forty people on it…",
  "What users report instead of the actual problem…",
  "The most-ignored automated email in the company…",
  "A problem that fixes itself the moment someone senior joins the call…",
  "The real priority of a ticket marked 'urgent'…",
  "A password policy that has clearly gone too far…",
  "What the VPN is thinking right now…",
  "The most-clicked link in the phishing awareness training…",
  "The real reason that access request still hasn't come through…",
  "What happens to a system the week before everyone goes on leave…",
  "An investigation that concluded, after six weeks, that the cause was <BLANK>",

  // ── Meetings and the calendar ─────────────────────────────────────────────
  "The real reason this meeting could have been an email…",
  "What a 'quick five-minute sync' becomes…",
  "The true meaning of 'per my previous email'…",
  "A calendar invite title that should be illegal…",
  "The fastest way to make an entire call unmute at once…",
  "What everyone is actually doing during the pre-read…",
  "The most creative excuse for keeping the camera off…",
  "How you know the agenda was written two minutes before the call…",
  "What 'circling back' really involves…",
  "The correct response to 'can you see my screen?'…",
  "The unspoken rule of the last five minutes of any call…",
  "A recurring invite that outlived the project it was created for, called <BLANK>",
  "What actually happens to the action items…",
  "The real reason someone joined this call…",
  "What 'quick call?' in a direct message actually means…",
  "A meeting that should be replaced by a single sentence in a chat channel…",

  // ── Desks, offices and hybrid work ────────────────────────────────────────
  "The best part of hybrid work nobody admits out loud…",
  "What 4:30pm coffee actually means before a steering committee…",
  "The honest reason someone booked the big meeting room…",
  "A perfectly normal thing to keep at your desk…",
  "The real reason nobody sits in the same seat twice…",
  "What the whiteboard in the corner has said for eight months…",
  "The correct thing to bring to a team offsite…",
  "What the office fridge is currently hiding…",
  "The unwritten rule of the office kitchen…",
  "A noise in an open-plan office that should carry a penalty…",
  "What the last person to leave the office always forgets…",
  "The real purpose of the standing desk nobody raises…",
  "What happens to anything left in the printer tray…",
  "The most honest thing a desk booking system could tell you…",
  "What working from home has done to your sense of time…",
  "A video-call background that says far too much…",

  // ── Admin: timesheets, expenses, process ──────────────────────────────────
  "The real purpose of the timesheet…",
  "What the expense policy says about that receipt…",
  "The hardest thing to justify on an expense claim…",
  "A mandatory training module that should exist…",
  "The real reason that form has eleven fields…",
  "What the approval workflow is protecting us from…",
  "What happens to documents once they are 'in the shared drive'…",
  "A folder name guaranteeing nobody will ever find the file again…",
  "What version 'final_v4_FINAL_reviewed' is actually a draft of…",
  "The naming convention everyone claims to follow…",
  "The real reason that field is mandatory…",
  "What gets booked to 'general project activity'…",

  // ── Clients and the business ──────────────────────────────────────────────
  "The real reason the business wants it 'like the old system'…",
  "What the business means by 'small change'…",
  "The most flattering thing a client has ever called a consultant…",
  "A question in a workshop that stops the room dead…",
  "What actually happens in the first ten minutes of a workshop…",
  "The most-asked question that has no good answer…",
  "What the business really wants instead of the report they asked for…",
  "The giveaway that a stakeholder hasn't read the document…",
  "What 'let's take that offline' means…",
  "The most useful thing ever said by someone who wasn't invited…",
  "A perfectly reasonable requirement that will take eleven months…",
  "A 300-word requirement, written as one sentence, that boils down to…",

  // ── Life on the team ──────────────────────────────────────────────────────
  "The team's unofficial superpower under a deadline…",
  "What the team chat channel is really for…",
  "A skill that belongs on a CV: 'Expert in <BLANK>'",
  "The most valuable thing a new joiner learns in week one…",
  "What the graduate intake refuses to believe about how we used to work…",
  "The team's real onboarding document, in one line…",
  "What AI will never take over on this team…",
  "How this team actually makes decisions…",
  "The greatest achievement that will never appear on a slide…",
  "A badge of honour on this team: surviving <BLANK>",
  "The one piece of advice you'd give your first-week self…",
  "The one thing every town hall needs more of…",
  "A new award this team should hand out…",
  "A tradition this team should adopt immediately…",
  "The real reason that documentation was never finished…"
];

/**
 * Grand final prompts. Everyone answers the same one and the whole room votes, so these
 * are built to reward a single sharp line. Fill-in-the-blank works especially well here.
 */
export const FINAL_PROMPTS = [
  "The honest tagline for this project would be: <BLANK>",
  "This team's motto, if we were being truthful: <BLANK>",
  "A new mandatory field on every requirement form: <BLANK>",
  "The warning label on an ERP implementation: <BLANK>",
  "The one house rule for every project from now on: <BLANK>",
  "Breaking news from the go-live weekend: consultant discovers <BLANK>",
  "My autobiography of this rollout will be called <BLANK>",
  "Instead of a status colour, projects should be rated by <BLANK>",
  "The real acceptance criterion was always <BLANK>",
  "A certification everyone here already qualifies for: Certified <BLANK>",
  "The plaque on the war room door should read: <BLANK>",
  "Archaeologists opening our project archive in 3000 will conclude we worshipped <BLANK>",
  "The sequel nobody asked for: <BLANK>, Phase 2",
  "From today it is officially forbidden to <BLANK>",
  "The one thing they never tell you on your first SAP project: <BLANK>",
  "The one rule we should add to every project from now on: <BLANK>",
  "Every status meeting should be replaced by <BLANK>",
  "The true measure of a senior consultant is <BLANK>",
  "The bravest line in our business case was <BLANK>",
  "This team's superpower, officially registered as <BLANK>",
  "The correct unit for measuring project progress is <BLANK>",
  "A prize awarded at every go-live: the <BLANK> award",
  "The support ticket that will outlive us all simply says <BLANK>",
  "Found in a time capsule from this quarter: <BLANK>",
  "This team would run twice as well if everyone just <BLANK>",
  "The unofficial job title on my business card is <BLANK>",
  "Every project retrospective can be summarised as <BLANK>",
  "The first rule of hypercare club is <BLANK>",
  "Our legacy to the next project team is <BLANK>",
  "The root cause, after a six-week investigation, turned out to be <BLANK>"
];

/** Submitted for anyone who runs out of time. Gentle, and obviously a placeholder. */
export const SAFETY_QUIPS = [
  "Parked for now — see RAID log",
  "Pending business sign-off",
  "Deferred to phase 2",
  "Awaiting clarification from the client",
  "Something much funnier, blocked by a dependency",
  "Ran out of runway on this one",
  "Left as an exercise for the reviewer",
  "In scope, out of time",
  "Currently amber",
  "Will be documented later",
  "Escalated to the steering committee",
  "Placeholder — do not ship"
];

/** Team names, assigned at random. Twenty teams need twenty, so there's room to spare. */
export const TEAM_NAMES = [
  'The ABAP Wizards', 'Cutover Crew', 'Hypercare Heroes', 'The S/4 Slayers',
  'BAPI Bandits', 'Fiori Firestarters', 'Transport Champions', 'The HANA Mavericks',
  'Scope Creep Survivors', 'The Coffee Consultants', 'Amber Status Alliance',
  'The Z-Table Zealots', 'Master Data Menaces', 'Regression Rangers',
  'The Dependency Dodgers', 'Blueprint Buccaneers', 'Go-Live Gladiators',
  'The Reconciliation Squad', 'Sandbox Pirates', 'The Green Status Gang',
  'RAID Log Renegades', 'Fit-Gap Fighters', 'The Unmute Squad',
  'Per My Previous Email', 'The Offline Takers', 'Idoc Idols',
  'Legacy Whisperers', 'The Rollback Rebels', 'Steering Committee Survivors',
  'The Pre-Read Optimists', 'Change Request Crushers', 'The Final_v4 Finalists',
  'Timesheet Titans', 'The Workshop Warriors', 'Basis Instinct',
  'The Critical Path', 'Defect Detectives', 'The Hotfix Heroes',
  'Camera Off Crew', 'The Parking Lot'
];

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
