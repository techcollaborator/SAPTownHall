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
  // ── SAP, the product family ────────────────────────────────────────────────
  "If SAP stood for three honest words, they would be…",
  "The real reason nobody will touch that Z-report from 2011…",
  "A transaction code that should exist but doesn't…",
  "The most menacing thing SAP GUI has ever said to you…",
  "How you'd explain S/4HANA to your grandmother in one sentence…",
  "A Fiori tile nobody asked for…",
  "The true purpose of the SAP Easy Access screen…",
  "What the little hourglass is actually doing all that time…",
  "A new SAP module the practice desperately needs…",
  "The most optimistic thing ever written in a solution architecture doc…",
  "What BTP would be called if the marketing team had taken the day off…",
  "A sentence that makes every Basis admin's eye twitch…",
  "The one thing a custom enhancement always breaks…",
  "What IDocs do when nobody is watching…",
  "A realistic error message SAP should ship instead of 'An error occurred'…",
  "The hidden feature in every SAP release note…",
  "What 'standard functionality' means once the client sees it…",
  "A dialog box that would genuinely improve your day…",
  "The dark secret of the master data team…",
  "How you know a system is running on someone's forgotten sandbox…",
  "A legacy system that refuses to die, and its reason for living…",
  "The most-used field in any SAP implementation: the 'notes' field, containing…",
  "What Joule should answer when asked 'is this project on track?'…",
  "A brand-new SAP certification the world is waiting for: Certified <BLANK>",
  "The real difference between a workaround and a solution…",

  // ── Cutover, go-live, hypercare ───────────────────────────────────────────
  "You know it's cutover weekend when…",
  "The most terrifying four words to hear at 2am on go-live night…",
  "What's actually in the go-live war room besides laptops…",
  "The real reason that transport is still sitting in QA…",
  "A hypercare ticket title that tells you everything…",
  "The go-live checklist item everyone pretends to have done…",
  "What 'we'll fix it in hypercare' really means…",
  "The unofficial mascot of a cutover weekend…",
  "How the team celebrates a clean go-live…",
  "The bravest thing anyone has said in a cutover call…",
  "A reason to roll back that nobody could have predicted…",
  "The first thing that breaks five minutes after go-live…",
  "What the dress rehearsal rehearses, and what it definitely doesn't…",
  "A sound that should never be heard during a data load…",
  "The real unit of measurement for a cutover: not hours, but <BLANK>",

  // ── Data migration & testing ──────────────────────────────────────────────
  "The number one law of data migration, learned the hard way…",
  "What the legacy data actually looks like once you open it…",
  "A customer record that should not legally exist…",
  "The most creative thing someone put in a mandatory field…",
  "What UAT stands for on day three of UAT…",
  "A test script step that everyone skips…",
  "The defect severity level we secretly need between 'high' and 'critical'…",
  "What a tester means by 'it works on my machine'…",
  "The most suspicious thing about a green test report…",
  "A data quality issue that somehow became a business process…",
  "How many records were in scope at kickoff versus now…",
  "The real reason reconciliation doesn't reconcile…",
  "A unit of test data that has been copied between systems since 2009: <BLANK>",
  "What 'cleansed data' means in practice…",

  // ── Project life: scope, plans, status ────────────────────────────────────
  "The most dangerous sentence in a project status deck…",
  "What amber status actually means…",
  "The real definition of scope creep, in one image…",
  "A change request nobody will approve but everyone will implement…",
  "What the project plan says versus what the project does…",
  "The true purpose of the RAID log…",
  "A milestone name that should be banned…",
  "What 'we're tracking to plan' translates to…",
  "The one slide that gets reused in every steering committee…",
  "A realistic name for phase 2…",
  "The actual critical path of this project…",
  "What happens to the risk register after week three…",
  "How the estimate was really produced…",
  "A dependency nobody wrote down…",
  "The bravest number in the business case…",
  "What 'minimum viable' turned out to mean…",
  "A lessons-learned entry that appears at the end of every single project…",
  "The real reason the timeline is exactly as long as it is…",
  "A project codename that gave away far too much…",
  "What the burndown chart is burning down…",

  // ── Client & consulting life ──────────────────────────────────────────────
  "The real reason the client wants it 'like the old system'…",
  "What the client means by 'small change'…",
  "The most flattering thing a client has ever called a consultant…",
  "A question in a workshop that stops the room dead…",
  "What actually happens in the first ten minutes of a workshop…",
  "The most-asked question that has no good answer…",
  "A requirement written entirely in one sentence, 300 words long, saying…",
  "What the business really wants instead of the report they asked for…",
  "The real reason that decision keeps getting deferred…",
  "How to tell a stakeholder has not read the document…",
  "The unwritten rule of the client site kitchen…",
  "A phrase that instantly reveals you've never worked in the business…",
  "What 'let's take that offline' means…",
  "The most useful thing ever said by someone who wasn't invited to the meeting…",
  "A perfectly reasonable requirement that will take eleven months…",

  // ── Meetings & the calendar ───────────────────────────────────────────────
  "The real reason this meeting could have been an email…",
  "What a 'quick five-minute sync' becomes…",
  "The true meaning of 'per my previous email'…",
  "A calendar invite title that should be illegal…",
  "The fastest way to make an entire call unmute at once…",
  "What everyone is actually doing during the pre-read…",
  "The most creative excuse for keeping the camera off…",
  "A meeting that should be replaced by a single sentence in a channel…",
  "How you know the agenda was written two minutes before the call…",
  "What 'circling back' really involves…",
  "The correct response to 'can you see my screen?'…",
  "The unspoken rule of the last five minutes of any call…",
  "A recurring invite that has outlived the project it was created for, called <BLANK>",
  "What happens to the action items…",
  "The real reason someone joined this call…",

  // ── Tools, tickets & process ──────────────────────────────────────────────
  "The real purpose of the timesheet…",
  "What the expense policy says about that receipt…",
  "A ticket description that is just the word 'broken'…",
  "The most honest possible SLA…",
  "What the approval workflow is protecting us from…",
  "A mandatory training module that should exist…",
  "The real reason that field is mandatory…",
  "What the VPN is thinking right now…",
  "The most-ignored automated email in the practice…",
  "A password policy that has clearly gone too far…",
  "What happens to documents once they are 'in the shared drive'…",
  "The real naming convention everyone uses…",
  "A folder name that guarantees nobody will ever find the file…",
  "What version 'final_v4_FINAL_reviewed' is actually a draft of…",

  // ── Team & practice culture ───────────────────────────────────────────────
  "Our practice's unofficial superpower under a deadline…",
  "The one thing every town hall needs more of…",
  "A skill that belongs on a consulting CV: 'Expert in <BLANK>'",
  "What the team chat channel is really for…",
  "The honest reason someone booked the big meeting room…",
  "What 4:30pm coffee actually means before a steering committee…",
  "The best part of hybrid work nobody admits out loud…",
  "A new award the practice should hand out…",
  "The most valuable thing a new joiner learns in week one…",
  "What the graduate intake will find hardest to believe about how we used to work…",
  "The team's real onboarding document, in one line…",
  "A tradition this practice should adopt immediately…",
  "What AI will never take over in this job…",
  "The correct thing to bring to a team offsite…",
  "The real reason nobody sits in the same seat twice…",
  "A perfectly normal thing to keep at your desk…",
  "How this practice actually makes decisions…",
  "What the whiteboard in the corner has said for eight months…",
  "The greatest achievement that will never appear on a slide…",
  "A badge of honour in this practice: surviving <BLANK>",
  "The one piece of advice you'd give your first-week self…"
];

/**
 * Grand final prompts. Everyone answers the same one and the whole room votes, so these
 * are built to reward a single sharp line. Fill-in-the-blank works especially well here.
 */
export const FINAL_PROMPTS = [
  "The honest tagline for this project would be: <BLANK>",
  "Our practice's motto, if we were being truthful: <BLANK>",
  "New mandatory field on every requirement form: <BLANK>",
  "The warning label on an ERP implementation: <BLANK>",
  "The one house rule for every project from now on: <BLANK>",
  "Breaking news from the go-live weekend: consultant discovers <BLANK>",
  "My autobiography of this rollout will be called <BLANK>",
  "Instead of a status colour, projects should be rated by <BLANK>",
  "The real acceptance criterion was always <BLANK>",
  "A new certification everyone here already qualifies for: Certified <BLANK>",
  "The plaque on the war room door should read: <BLANK>",
  "Archaeologists opening our project archive in 3000 will conclude we worshipped <BLANK>",
  "The sequel nobody asked for: <BLANK>, Phase 2",
  "From today it is officially forbidden to <BLANK>",
  "The one thing they never tell you on your first SAP project: <BLANK>",
  "This town hall's official souvenir is <BLANK>",
  "Replace every status meeting with <BLANK>",
  "The true measure of a senior consultant is <BLANK>",
  "The bravest line in our business case was <BLANK>",
  "Our team's superpower, officially registered as <BLANK>",
  "The correct unit for measuring project progress is <BLANK>",
  "A prize awarded at every go-live: the <BLANK> award",
  "The support ticket that will outlive us all simply says <BLANK>",
  "Found in a time capsule from this quarter: <BLANK>",
  "The practice would run twice as well if everyone just <BLANK>",
  "The unofficial job title on my business card is <BLANK>",
  "Every project retrospective can be summarised as <BLANK>",
  "What this room deserves after this quarter: <BLANK>",
  "The first rule of hypercare club is <BLANK>",
  "Our legacy to the next project team is <BLANK>"
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
