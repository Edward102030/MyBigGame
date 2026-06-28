/**
 * TINY KINGDOM — game.js
 * The most addictive browser strategy game possible.
 * Core addiction loops:
 * 1. Daily streak system
 * 2. Cliffhanger events (consequences revealed next session)
 * 3. Permanent consequences (real stakes)
 * 4. Visual kingdom growth (satisfying progress)
 * 5. Achievement dopamine hits
 * 6. Near-miss mechanics (almost lost!)
 * 7. Narrative investment (named characters, stories)
 */
(function(){
'use strict';

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const TOTAL_DAYS = 90;   // 3 in-game years
const MAX_STAT   = 200;
const SAVE_KEY   = 'tinykingdom_v3';
const META_KEY   = 'tinykingdom_meta';

const SEASONS = [
  {name:'Spring',icon:'🌱',color:'#4a8a2a',days:[1,22]},
  {name:'Summer',icon:'☀',color:'#c8860a',days:[23,45]},
  {name:'Autumn',icon:'🍂',color:'#8a3a0a',days:[46,67]},
  {name:'Winter',icon:'❄',color:'#3a5a7a',days:[68,90]},
];

const KINGDOM_NAMES=[
  'Ironveil','Ashmore','Crestholm','Dawnshire','Eldergate',
  'Frostmere','Goldenmarch','Halverton','Ironpeak','Jadehaven',
  'Kestrelford','Lionsmere','Moonvale','Northgate','Oakhaven',
];

/* ══════════════════════════════════════════════
   GAME STATE
══════════════════════════════════════════════ */
const G = {
  // Resources (0-200)
  gold:100, food:80, army:20, happy:75, pop:50,
  // Kingdom
  day:1, score:0,
  name:'',
  buildings:[], // {id, name, icon, effect}
  achievements:[], // unlocked achievement ids
  events_seen:[], // event ids seen this run
  pending_event:null, // event queued for next session (cliffhanger)
  history:[], // {day, event, choice, outcome}
  // Meta (persists across runs)
  streak:0,
  last_played:'',
  best_score:0,
  total_runs:0,
  all_achievements:[],
};

/* ══════════════════════════════════════════════
   BUILDINGS
══════════════════════════════════════════════ */
const BUILDINGS = {
  farm:       {id:'farm',       name:'Farm',         icon:'🌾', desc:'+5 Food/day'},
  market:     {id:'market',     name:'Market',       icon:'🏪', desc:'+8 Gold/day'},
  barracks:   {id:'barracks',   name:'Barracks',     icon:'⚔',  desc:'+6 Army/day'},
  tavern:     {id:'tavern',     name:'Tavern',       icon:'🍺', desc:'+5 Happiness/day'},
  library:    {id:'library',    name:'Library',      icon:'📚', desc:'Unlocks advanced events'},
  cathedral:  {id:'cathedral',  name:'Cathedral',    icon:'⛪', desc:'+8 Happiness, reduces unrest'},
  forge:      {id:'forge',      name:'Forge',        icon:'🔨', desc:'+10 Army/day'},
  granary:    {id:'granary',    name:'Granary',      icon:'🌽', desc:'Prevents famine'},
  treasury:   {id:'treasury',   name:'Treasury',     icon:'💰', desc:'Gold cap +100'},
  walls:      {id:'walls',      name:'City Walls',   icon:'🧱', desc:'+30 Army defence'},
  harbour:    {id:'harbour',    name:'Harbour',      icon:'⚓', desc:'+12 Gold/day, opens trade'},
  palace:     {id:'palace',     name:'Palace',       icon:'🏰', desc:'+15 all stats, prestige'},
};

/* ══════════════════════════════════════════════
   ACHIEVEMENTS
══════════════════════════════════════════════ */
const ACHIEVEMENTS = [
  {id:'first_win',    icon:'👑', name:'First Legend',     desc:'Complete your first campaign',   check:()=>G.day>=TOTAL_DAYS},
  {id:'golden_age',   icon:'⚜', name:'Golden Age',       desc:'Reach 150 gold',                check:()=>G.gold>=150},
  {id:'iron_fist',    icon:'⚔', name:'Iron Fist',        desc:'Reach 100 army strength',       check:()=>G.army>=100},
  {id:'beloved',      icon:'❤', name:'Beloved Ruler',    desc:'Keep happiness above 90 for 10 days', check:()=>false}, // tracked manually
  {id:'survivor',     icon:'💪', name:'Survivor',        desc:'Recover from near-bankruptcy',  check:()=>false},
  {id:'builder',      icon:'🏗', name:'Master Builder',  desc:'Construct 5 buildings',         check:()=>G.buildings.length>=5},
  {id:'scholar',      icon:'📚', name:'Scholar King',    desc:'Build the Library',             check:()=>G.buildings.some(b=>b.id==='library')},
  {id:'populist',     icon:'👥', name:'People\'s King',  desc:'Reach 120 population',          check:()=>G.pop>=120},
  {id:'centurion',    icon:'🏛', name:'Centurion',       desc:'Survive to day 30',             check:()=>G.day>=30},
  {id:'half_way',     icon:'🌗', name:'Halfway There',   desc:'Survive to day 45',             check:()=>G.day>=45},
  {id:'palace_built', icon:'🏰', name:'Imperial Palace', desc:'Build the Palace',              check:()=>G.buildings.some(b=>b.id==='palace')},
  {id:'rich',         icon:'💎', name:'Treasury Full',   desc:'Reach 180 gold',                check:()=>G.gold>=180},
  {id:'warmonger',    icon:'🗡', name:'Warmonger',       desc:'Reach 150 army strength',       check:()=>G.army>=150},
  {id:'peacekeeper',  icon:'🕊', name:'Peacekeeper',    desc:'Complete campaign without war',  check:()=>false},
  {id:'comeback',     icon:'🔄', name:'Great Comeback',  desc:'Survive with gold below 10',    check:()=>false},
];

/* ══════════════════════════════════════════════
   THE EVENT DATABASE
   120+ unique events with branching choices
   and real consequences
══════════════════════════════════════════════ */
const EVENTS = [
// ─────────────────────────────────────────────
// SPRING EVENTS (days 1-22)
// ─────────────────────────────────────────────
{
  id:'spring_merchant',season:0,minDay:2,maxDay:10,weight:10,
  icon:'🛒',title:'A Wandering Merchant',
  body:'A merchant caravan has arrived at your gates, carrying silks, spices, and rare goods from distant lands. They offer you a trade — but their prices seem steep.',
  choices:[
    {text:'Trade generously',effect:'Gold -20, Happiness +15, Pop +5',
     resolve:(g)=>{g.gold-=20;g.happy+=15;g.pop+=5;},
     outcome:'The merchants spread word of your generosity. Your people celebrate in the streets!',icon:'🎉',good:true},
    {text:'Negotiate hard',effect:'Gold -8, Pop +3',
     resolve:(g)=>{g.gold-=8;g.pop+=3;},
     outcome:'You drive a shrewd bargain. The merchants grumble but accept. You got the better deal.',icon:'🤝',good:true},
    {text:'Turn them away',effect:'Nothing changes',
     resolve:(g)=>{},
     outcome:'The merchants leave. Your treasury is intact, but your people seem disappointed.',icon:'😐'},
  ]
},
{
  id:'spring_flood',season:0,minDay:1,maxDay:20,weight:8,
  icon:'🌊',title:'The River Floods',
  body:'Melting snow has swollen the river beyond its banks. Farmland is submerged. Your people look to you for guidance.',
  choices:[
    {text:'Build emergency levees (Cost: 30 Gold)',effect:'Gold -30, Food +20, Pop +8',
     resolve:(g)=>{g.gold-=30;g.food+=20;g.pop+=8;},
     outcome:'The levees hold! Farmers salvage their crops. Your decisive action saves the harvest.',icon:'💪',good:true},
    {text:'Pray for the waters to recede',effect:'Food -15 (risky)',risk:'25% chance Food -30',
     resolve:(g)=>{g.food-=15;if(Math.random()<.25)g.food-=30;},
     outcome:'The river eventually subsides. Some crops are lost, but the kingdom endures.',icon:'🙏'},
    {text:'Relocate farms to higher ground',effect:'Gold -15, Pop -5, Food +10 (permanent)',
     resolve:(g)=>{g.gold-=15;g.pop-=5;g.food+=10;},
     outcome:'The move is costly, but your farms are now safer for generations to come.',icon:'🏔',good:true},
  ]
},
{
  id:'spring_twins',season:0,minDay:3,maxDay:15,weight:6,
  icon:'👶',title:'Royal Twins Born',
  body:'Great news spreads through the kingdom — twins have been born to a noble family. The people see it as a divine omen of prosperity.',
  choices:[
    {text:'Declare a week of celebration',effect:'Gold -10, Happiness +25, Pop +8',
     resolve:(g)=>{g.gold-=10;g.happy+=25;g.pop+=8;},
     outcome:'The celebrations last for days! Music fills the streets and your people love you for it.',icon:'🎊',good:true},
    {text:'Offer a modest gift',effect:'Gold -5, Happiness +10',
     resolve:(g)=>{g.gold-=5;g.happy+=10;},
     outcome:'Your gift is graciously received. A warm feeling spreads through the kingdom.',icon:'🎁',good:true},
    {text:'Acknowledge it quietly',effect:'Nothing',
     resolve:(g)=>{},
     outcome:'Life goes on. The people notice your indifference but say nothing — yet.',icon:'😐'},
  ]
},
{
  id:'spring_bandits',season:0,minDay:5,maxDay:22,weight:9,
  icon:'🗡',title:'Bandits on the Eastern Road',
  body:'Merchants are being robbed on the eastern road. Trade has slowed to a trickle. Your citizens demand action.',
  choices:[
    {text:'Send soldiers to clear them out',effect:'Army -10, Gold +20, Pop +5',
     resolve:(g)=>{g.army-=10;g.gold+=20;g.pop+=5;},
     outcome:'Your soldiers rout the bandits. Trade resumes and grateful merchants pay a tithe.',icon:'⚔',good:true},
    {text:'Hire mercenaries',effect:'Gold -20, Gold +15 (net -5)',
     resolve:(g)=>{g.gold-=5;},
     outcome:'The mercenaries clear the road but charge a hefty fee. At least the problem is solved.',icon:'💰'},
    {text:'Negotiate with the bandits',effect:'Gold -15, Happy +5',risk:'30% they attack anyway',
     resolve:(g)=>{g.gold-=15;g.happy+=5;if(Math.random()<.3){g.army-=15;g.pop-=10;}},
     outcome:'Risky negotiations — the result could go either way.',icon:'🤝'},
    {text:'Ignore the problem',effect:'Gold -15/day (trade suffers)',
     resolve:(g)=>{g.gold-=15;g.happy-=10;},
     outcome:'The bandits grow bolder. Trade collapses and your people blame you.',icon:'😠',bad:true},
  ]
},
{
  id:'spring_wizard',season:0,minDay:8,maxDay:22,weight:5,
  icon:'🧙',title:'A Wizard Seeks Refuge',
  body:'An old wizard, weathered and weary, arrives at your gates. He claims to be fleeing persecution from a neighbouring kingdom and offers his services in exchange for protection.',
  choices:[
    {text:'Welcome him — his wisdom is valuable',effect:'Happy +10, Army +15 (magical aid)',
     resolve:(g)=>{g.happy+=10;g.army+=15;},
     outcome:'The wizard proves his worth! Strange lights glow from the tower as he works his craft.',icon:'✨',good:true},
    {text:'Offer shelter but restrict his magic',effect:'Happy +5, Gold +5',
     resolve:(g)=>{g.happy+=5;g.gold+=5;},
     outcome:'A cautious welcome. The wizard accepts your terms and lives quietly in your kingdom.',icon:'🏠'},
    {text:'Turn him away — too dangerous',effect:'Nothing',
     resolve:(g)=>{},
     outcome:'The wizard departs without complaint. You notice a faint sadness in his eyes.',icon:'👋'},
  ]
},
{
  id:'spring_tournament',season:0,minDay:10,maxDay:22,weight:7,
  icon:'🏆',title:'A Great Tournament',
  body:'Knights from across the land request permission to hold a tournament in your city. It would attract visitors and boost morale — but it comes at a cost.',
  choices:[
    {text:'Host a grand tournament',effect:'Gold -25, Happy +30, Pop +10, Army +10',
     resolve:(g)=>{g.gold-=25;g.happy+=30;g.pop+=10;g.army+=10;},
     outcome:'The tournament is spectacular! Knights compete, crowds cheer, and your name is celebrated across the realm.',icon:'🎺',good:true},
    {text:'Host a modest event',effect:'Gold -10, Happy +15, Pop +5',
     resolve:(g)=>{g.gold-=10;g.happy+=15;g.pop+=5;},
     outcome:'A smaller affair, but your people enjoy it. The streets are lively for days.',icon:'🎪'},
    {text:'Decline — focus on the harvest',effect:'Food +15',
     resolve:(g)=>{g.food+=15;},
     outcome:'Your farmers work hard while others play. The harvest will be better for it.',icon:'🌾'},
  ]
},
// ─────────────────────────────────────────────
// SUMMER EVENTS (days 23-45)
// ─────────────────────────────────────────────
{
  id:'summer_drought',season:1,minDay:23,maxDay:45,weight:10,
  icon:'☀',title:'A Devastating Drought',
  body:'The summer sun beats down mercilessly. Wells run dry. Crops wither. Your people begin to ration food. This is your most serious test yet.',
  choices:[
    {text:'Irrigate fields immediately (Gold -35)',effect:'Gold -35, Food +25, Pop +5',
     resolve:(g)=>{g.gold-=35;g.food+=25;g.pop+=5;},
     outcome:'The irrigation channels save the harvest. Farmers weep with relief. Your people will not forget this.',icon:'💧',good:true},
    {text:'Import food from neighbours',effect:'Gold -20, Food +15',
     resolve:(g)=>{g.gold-=20;g.food+=15;},
     outcome:'Expensive but effective. Your treasury takes a hit, but your people eat tonight.',icon:'🚢'},
    {text:'Ration strictly and pray',effect:'Food -10, Happy -15',risk:'20% famine: Pop -20',
     resolve:(g)=>{g.food-=10;g.happy-=15;if(Math.random()<.2){g.pop-=20;g.happy-=20;}},
     outcome:'A gamble with your people\'s lives. Some will remember this choice forever.',icon:'🙏',risky:true},
    {text:'Open the royal granary',effect:'Food +30, Happy +20, Gold -0 (uses stored food)',
     resolve:(g)=>{g.food+=30;g.happy+=20;},
     outcome:'Only possible if you built the granary. Your foresight saves thousands of lives.',icon:'🌽',
     requires:'granary',requireText:'Requires: Granary built',good:true},
  ]
},
{
  id:'summer_ambassador',season:1,minDay:25,maxDay:44,weight:8,
  icon:'👑',title:'Foreign Ambassador',
  body:'An ambassador from the Kingdom of Valdris arrives bearing gifts and a proposal: a mutual defence pact. They are powerful — but alliances come with obligations.',
  choices:[
    {text:'Accept the alliance',effect:'Army +30, Gold +10, Happy +10',
     resolve:(g)=>{g.army+=30;g.gold+=10;g.happy+=10;},
     outcome:'The alliance is sealed with a feast. Your kingdom is now protected by a powerful neighbour.',icon:'🤝',good:true},
    {text:'Accept trade only (no military)',effect:'Gold +25',
     resolve:(g)=>{g.gold+=25;},
     outcome:'A trade agreement is signed. Caravans begin flowing between kingdoms, filling your coffers.',icon:'📜'},
    {text:'Politely decline',effect:'Nothing, remain independent',
     resolve:(g)=>{},
     outcome:'The ambassador departs. Your kingdom remains independent — for now.',icon:'🏴'},
    {text:'Demand tribute first',effect:'Gold +30, Army -10 (tensions rise)',
     resolve:(g)=>{g.gold+=30;g.army-=10;},
     outcome:'The ambassador is insulted but pays. Relations are strained — this may come back to haunt you.',icon:'⚠',risky:true},
  ]
},
{
  id:'summer_fire',season:1,minDay:28,maxDay:44,weight:9,
  icon:'🔥',title:'The Great Market Fire',
  body:'A fire breaks out in the market district! Flames leap from stall to stall. Citizens scramble to escape. Every second counts.',
  choices:[
    {text:'Deploy the army to fight the fire',effect:'Army -5, Gold -10, Pop +0 (saved)',
     resolve:(g)=>{g.army-=5;g.gold-=10;g.happy+=15;},
     outcome:'Your soldiers form water chains and contain the blaze. The market is saved. The people cheer.',icon:'💪',good:true},
    {text:'Let it burn, focus on evacuation',effect:'Gold -30 (rebuilding), Pop -5',
     resolve:(g)=>{g.gold-=30;g.pop-=5;g.happy-=10;},
     outcome:'Lives are saved but the market is lost. Rebuilding will cost dearly.',icon:'😢'},
    {text:'Burn a firebreak through neighbouring buildings',effect:'Gold -20, Saves most of market',
     resolve:(g)=>{g.gold-=20;g.happy-=5;g.gold+=10;},
     outcome:'A ruthless but effective tactic. Some buildings are sacrificed to save the rest.',icon:'🏚',risky:true},
  ]
},
{
  id:'summer_plague',season:1,minDay:30,maxDay:44,weight:8,
  icon:'🤒',title:'A Plague Arrives',
  body:'Terrible news — a sickness is spreading through the eastern provinces. Travellers bring it to your city gates. If it enters the walls, it could devastate your population.',
  choices:[
    {text:'Seal the city gates (quarantine)',effect:'Gold -10, Happy -20, Pop +10 (protected)',
     resolve:(g)=>{g.gold-=10;g.happy-=20;g.pop+=10;},
     outcome:'Your people resent the lockdown — but months later they realise you saved their lives.',icon:'🔒',good:true},
    {text:'Allow healers in, take the risk',effect:'Happy +10',risk:'40% Pop -25',
     resolve:(g)=>{g.happy+=10;if(Math.random()<.4){g.pop-=25;g.happy-=30;}},
     outcome:'A dangerous gamble. The sickness may or may not breach your walls.',icon:'⚕',risky:true},
    {text:'Build a hospital immediately',effect:'Gold -30, Pop +15, permanent disease resistance',
     resolve:(g)=>{g.gold-=30;g.pop+=15;g.happy+=10;},
     outcome:'The hospital contains the outbreak and saves lives for generations to come.',icon:'🏥',good:true},
  ]
},
{
  id:'summer_harvest_good',season:1,minDay:40,maxDay:44,weight:10,
  icon:'🌾',title:'A Bountiful Harvest',
  body:'Your farmers return from the fields with more grain than anyone can remember seeing. The harvest is exceptional — almost miraculously so.',
  choices:[
    {text:'Store the excess for winter',effect:'Food +40',
     resolve:(g)=>{g.food+=40;},
     outcome:'Wise hoarding. When winter bites, your people will eat while others starve.',icon:'🌽',good:true},
    {text:'Sell the surplus for gold',effect:'Gold +30, Food +15',
     resolve:(g)=>{g.gold+=30;g.food+=15;},
     outcome:'The surplus fills your treasury. A fine balance of security and profit.',icon:'⚜'},
    {text:'Host a harvest festival',effect:'Happy +25, Pop +10, Food +15',
     resolve:(g)=>{g.happy+=25;g.pop+=10;g.food+=15;},
     outcome:'The greatest festival your kingdom has ever seen! Songs will be sung about this harvest for decades.',icon:'🎊',good:true},
  ]
},
{
  id:'summer_spy',season:1,minDay:26,maxDay:44,weight:6,
  icon:'🕵',title:'A Spy in the Court',
  body:'Your captain of the guard informs you — in hushed tones — that a spy from a rival kingdom has been captured. He carries coded letters revealing a plot against you.',
  choices:[
    {text:'Execute the spy publicly',effect:'Army +10, Happy -5, Fear established',
     resolve:(g)=>{g.army+=10;g.happy-=5;},
     outcome:'The execution sends a clear message. Your enemies think twice before acting.',icon:'⚔',risky:true},
    {text:'Interrogate and use as a double agent',effect:'Army +20, Intel advantage',
     resolve:(g)=>{g.army+=20;g.gold+=15;},
     outcome:'Brilliant! You turn the spy against his own masters. Their plans are now your plans.',icon:'🎭',good:true},
    {text:'Release him as a show of mercy',effect:'Happy +15, Reputation +good',
     resolve:(g)=>{g.happy+=15;g.pop+=5;},
     outcome:'Your mercy becomes legend. People across the realm speak of your noble character.',icon:'🕊'},
  ]
},
// ─────────────────────────────────────────────
// AUTUMN EVENTS (days 46-67)
// ─────────────────────────────────────────────
{
  id:'autumn_rebellion',season:2,minDay:46,maxDay:66,weight:9,
  icon:'✊',title:'Rebellion in the North',
  body:'A charismatic rebel leader has raised a banner in the northern hills, promising lower taxes and freedom. Hundreds of your citizens are listening. This could become a war.',
  choices:[
    {text:'Crush the rebellion with military force',effect:'Army -25, Happy -10, order restored',
     resolve:(g)=>{g.army-=25;g.happy-=10;},
     outcome:'The rebellion is crushed. Order is restored, but the songs they sing about it are not kind.',icon:'⚔',risky:true},
    {text:'Meet with the rebel leader',effect:'Happy +20, Gold -15 (tax reduction)',
     resolve:(g)=>{g.happy+=20;g.gold-=15;},
     outcome:'You listen, you compromise, you find common ground. The rebellion dissolves. Your people call you wise.',icon:'🤝',good:true},
    {text:'Bribe the rebel leader',effect:'Gold -30, Problem solved temporarily',
     resolve:(g)=>{g.gold-=30;},
     outcome:'The gold changes hands. The rebel disbands his forces — for now. But this may not be the last you hear of him.',icon:'💰',risky:true},
    {text:'Ignore it and hope it fades',effect:'Happy -25, Army -10',risk:'50% full rebellion',
     resolve:(g)=>{g.happy-=25;g.army-=10;if(Math.random()<.5){g.pop-=20;g.army-=20;}},
     outcome:'Ignoring a fire never puts it out. The consequences could be catastrophic.',icon:'🔥',bad:true},
  ]
},
{
  id:'autumn_harvest_poor',season:2,minDay:46,maxDay:60,weight:9,
  icon:'🌧',title:'A Poor Harvest',
  body:'Early frosts have damaged the crops. Your granaries are only half full as winter approaches. Your people are worried.',
  choices:[
    {text:'Import food urgently',effect:'Gold -25, Food +20',
     resolve:(g)=>{g.gold-=25;g.food+=20;},
     outcome:'Expensive, but necessary. Your people will not go hungry — this time.',icon:'🚢'},
    {text:'Ration food strictly',effect:'Happy -20, Pop -5, Food +15',
     resolve:(g)=>{g.happy-=20;g.pop-=5;g.food+=15;},
     outcome:'The rationing is unpopular but it keeps reserves stable. Winter will be hard.',icon:'😔'},
    {text:'Hunt the royal forests for game',effect:'Food +15, Happy +5',
     resolve:(g)=>{g.food+=15;g.happy+=5;},
     outcome:'The royal hunters bring back enough game to supplement the harvest. A creative solution.',icon:'🦌'},
    {text:'Open the palace kitchens to the poor',effect:'Happy +20, Food -10, Gold -5',
     resolve:(g)=>{g.happy+=20;g.food-=10;g.gold-=5;},
     outcome:'The gesture is remembered for generations. Your people would follow you anywhere.',icon:'❤',good:true},
  ]
},
{
  id:'autumn_general',season:2,minDay:48,maxDay:66,weight:7,
  icon:'⚔',title:'General Requests a Raise',
  body:'Your most loyal general — commander of the army — requests a significant pay raise. Without him, army morale could crumble. With him, your military is unmatched.',
  choices:[
    {text:'Grant the full raise',effect:'Gold -20/ongoing, Army +20, Happy army +15',
     resolve:(g)=>{g.gold-=20;g.army+=20;g.happy+=10;},
     outcome:'The general beams with pride. His loyalty — and that of his soldiers — is total.',icon:'🫡',good:true},
    {text:'Offer half',effect:'Gold -10, Army +5',
     resolve:(g)=>{g.gold-=10;g.army+=5;},
     outcome:'A compromise. The general accepts without complaint, though his smile doesn\'t quite reach his eyes.',icon:'🤝'},
    {text:'Refuse — discipline above all',effect:'Army -15, Happy -10',
     resolve:(g)=>{g.army-=15;g.happy-=10;},
     outcome:'The general leaves your service. His soldiers lose morale. This was a costly mistake.',icon:'😠',bad:true},
  ]
},
{
  id:'autumn_philosopher',season:2,minDay:50,maxDay:66,weight:5,
  icon:'📜',title:'The Philosopher\'s Proposal',
  body:'A renowned philosopher arrives with a proposal: build a great university and attract scholars from across the known world. It would cost a fortune but transform your kingdom\'s future.',
  choices:[
    {text:'Build the University',effect:'Gold -40, Pop +20, Army +10, Happy +15 (legacy)',
     resolve:(g)=>{g.gold-=40;g.pop+=20;g.army+=10;g.happy+=15;},
     outcome:'Scholars flock to your city. Within a generation, your kingdom leads the world in knowledge and innovation.',icon:'🎓',good:true},
    {text:'Offer partial funding',effect:'Gold -20, Pop +10',
     resolve:(g)=>{g.gold-=20;g.pop+=10;},
     outcome:'A smaller institution opens its doors. The philosopher calls it a start.',icon:'📚'},
    {text:'Decline — too expensive',effect:'Nothing',
     resolve:(g)=>{},
     outcome:'The philosopher leaves for a richer kingdom. You wonder sometimes what might have been.',icon:'😔'},
  ]
},
{
  id:'autumn_invasion',season:2,minDay:55,maxDay:67,weight:8,
  icon:'🛡',title:'Neighbouring Kingdom Threatens War',
  body:'The Kingdom of Darkhollow has massed troops on your border. Their king sends a message: pay tribute or face invasion. Your generals await your command.',
  choices:[
    {text:'Mobilise and prepare to fight',effect:'Army +20, Gold -20, Happy -10',
     resolve:(g)=>{g.army+=20;g.gold-=20;g.happy-=10;if(Math.random()<.5){g.army-=30;g.pop-=10;}else{g.army+=10;g.gold+=20;}},
     outcome:'War — the gamble of kings. Victory brings glory, defeat brings ruin.',icon:'⚔',risky:true},
    {text:'Pay the tribute',effect:'Gold -30, Peace maintained',
     resolve:(g)=>{g.gold-=30;g.happy-=5;},
     outcome:'Humiliating but pragmatic. Your treasury bleeds, but your people live to fight another day.',icon:'💰'},
    {text:'Forge a counter-alliance',effect:'Gold -15, Army +35',
     resolve:(g)=>{g.gold-=15;g.army+=35;},
     outcome:'You call in favours from distant kingdoms. Darkhollow backs down when they see your allies.',icon:'🤝',good:true},
    {text:'Assassinate their king',effect:'Army -10',risk:'Could escalate terribly',
     resolve:(g)=>{g.army-=10;if(Math.random()<.5){g.happy+=20;g.army+=15;}else{g.army-=30;g.pop-=20;}},
     outcome:'A dangerous gamble that could change everything.',icon:'🗡',risky:true},
  ]
},
// ─────────────────────────────────────────────
// WINTER EVENTS (days 68-90)
// ─────────────────────────────────────────────
{
  id:'winter_blizzard',season:3,minDay:68,maxDay:88,weight:10,
  icon:'❄',title:'The Great Blizzard',
  body:'A blizzard of unprecedented fury has buried your kingdom under three feet of snow. Roads are impassable. Fuel is running low. Your people huddle in their homes, cold and afraid.',
  choices:[
    {text:'Open the palace to the homeless',effect:'Happy +25, Gold -10, Pop +5',
     resolve:(g)=>{g.happy+=25;g.gold-=10;g.pop+=5;},
     outcome:'Hundreds shelter in your palace. When spring comes, these people will be your most devoted subjects.',icon:'❤',good:true},
    {text:'Distribute emergency fuel supplies',effect:'Gold -20, Happy +20',
     resolve:(g)=>{g.gold-=20;g.happy+=20;},
     outcome:'Your supply wagons brave the storm. Every household has fuel. Your people survive — and remember.',icon:'🔥'},
    {text:'Order everyone to stay indoors and wait',effect:'Happy -15',risk:'20% deaths from cold',
     resolve:(g)=>{g.happy-=15;if(Math.random()<.2){g.pop-=15;}},
     outcome:'The cold is merciless. Some who are weak do not survive the night.',icon:'😔',risky:true},
  ]
},
{
  id:'winter_mystery',season:3,minDay:70,maxDay:88,weight:6,
  icon:'🌙',title:'A Mysterious Stranger',
  body:'On a moonless night, a cloaked figure is brought before you. She claims to be a prophet who has foreseen the future of your kingdom — both the glory and the ruin.',
  choices:[
    {text:'Listen to her prophecy',effect:'Random: great boon or curse',
     resolve:(g)=>{if(Math.random()<.6){g.gold+=20;g.happy+=20;g.army+=15;}else{g.gold-=15;g.happy-=15;}},
     outcome:'The prophecy proves... interesting.',icon:'🔮',risky:true},
    {text:'Imprison her as a charlatan',effect:'Happy -5, Army +5',
     resolve:(g)=>{g.happy-=5;g.army+=5;},
     outcome:'Your guards lock her away. But strange dreams disturb your sleep for weeks.',icon:'🔒'},
    {text:'Give her shelter and freedom',effect:'Happy +10, mysterious bonus',
     resolve:(g)=>{g.happy+=10;g.food+=15;g.army+=10;},
     outcome:'The prophet stays, and strange good fortune seems to follow your kingdom.',icon:'✨',good:true},
  ]
},
{
  id:'winter_final_battle',season:3,minDay:80,maxDay:89,weight:9,
  icon:'⚔',title:'The Final Test',
  body:'A massive coalition of rival kingdoms has decided this is their moment. They march on your capital. Everything you have built is at stake. This is the battle that will define your legacy.',
  choices:[
    {text:'Meet them in open battle',effect:'Army -40, if army > 80: victory',
     resolve:(g)=>{g.army-=40;if(g.army>40){g.gold+=50;g.happy+=30;g.pop+=20;}else{g.pop-=30;g.happy-=30;}},
     outcome:'The battle of your generation. Victory or defeat is determined by the strength of your army.',icon:'⚔',risky:true},
    {text:'Retreat behind the walls and siege them out',effect:'Food -30, Army +10, Gold -20',
     resolve:(g)=>{g.food-=30;g.army+=10;g.gold-=20;g.happy+=10;},
     outcome:'A long siege. Your walls hold. Eventually the coalition runs out of supplies and retreats.',icon:'🧱'},
    {text:'Negotiate at the last moment',effect:'Gold -50, Peace — but pay tribute',
     resolve:(g)=>{g.gold-=50;g.happy-=10;},
     outcome:'A costly peace. Your treasury is diminished, but your kingdom stands.',icon:'🕊'},
    {text:'Use everything — every soldier, every trick',effect:'Army -60, decisive outcome',
     resolve:(g)=>{g.army-=60;if(g.army>0&&g.gold>30){g.gold+=80;g.happy+=50;g.pop+=30;}else{g.pop-=40;g.happy-=40;}},
     outcome:'You throw everything into this battle. The outcome will shape the history books.',icon:'💥',risky:true},
  ]
},
{
  id:'winter_legacy',season:3,minDay:85,maxDay:90,weight:10,
  icon:'📜',title:'The History Books',
  body:'As your third year draws to a close, a historian asks to record your reign for posterity. What will you be remembered for?',
  choices:[
    {text:'"A builder who raised a great city"',effect:'Score bonus for buildings',
     resolve:(g)=>{g.score+=g.buildings.length*50;g.happy+=10;},
     outcome:'The historian writes of your great works. Your buildings will outlast you by centuries.',icon:'🏛',good:true},
    {text:'"A warrior who never lost a battle"',effect:'Score bonus for army strength',
     resolve:(g)=>{g.score+=g.army*3;g.army+=20;},
     outcome:'Your battles are recorded with admiration. Soldiers name their children after you.',icon:'⚔',good:true},
    {text:'"A beloved ruler of a happy people"',effect:'Score bonus for happiness',
     resolve:(g)=>{g.score+=g.happy*5;g.pop+=20;},
     outcome:'The historian struggles to find enough pages. Story after story of people whose lives you improved.',icon:'❤',good:true},
  ]
},
// ─────────────────────────────────────────────
// UNIVERSAL (any season)
// ─────────────────────────────────────────────
{
  id:'build_farm',season:-1,minDay:1,maxDay:89,weight:8,
  icon:'🌾',title:'The Farmers\' Petition',
  body:'A delegation of farmers asks for help expanding their fields. With royal investment, they could triple the food supply — feeding your kingdom for years to come.',
  choices:[
    {text:'Fund the expansion (cost 20 gold)',effect:'Gold -20, Food +25, + Farm building',
     resolve:(g)=>{g.gold-=20;g.food+=25;addBuilding('farm');},
     outcome:'New fields stretch across the valley. Your food supply is now the envy of neighbouring kingdoms.',icon:'🌾',good:true},
    {text:'Offer them labour instead of gold',effect:'Army -5, Food +15',
     resolve:(g)=>{g.army-=5;g.food+=15;},
     outcome:'Soldiers temporarily work the fields. Morale dips slightly, but the harvest improves.',icon:'👷'},
    {text:'Let them fund it themselves',effect:'Food +5 (slowly)',
     resolve:(g)=>{g.food+=5;},
     outcome:'The farmers manage on their own, but progress is slow. Every little helps.',icon:'🐢'},
  ]
},
{
  id:'build_market',season:-1,minDay:5,maxDay:89,weight:8,
  icon:'🏪',title:'Merchants Propose a Market',
  body:'A group of wealthy merchants offers to build a permanent market if you provide the land and some funding. It would bring trade — and taxes — to your city.',
  choices:[
    {text:'Provide land and 25 gold',effect:'Gold -25, Gold +15/turn, + Market building',
     resolve:(g)=>{g.gold-=25;addBuilding('market');},
     outcome:'The market opens to great fanfare. Gold flows into your treasury from taxes and trade.',icon:'⚜',good:true},
    {text:'Provide land only',effect:'Gold +8/turn, smaller market',
     resolve:(g)=>{g.gold+=5;},
     outcome:'A modest market opens. Better than nothing, and it cost you nothing.',icon:'🪙'},
    {text:'Build the market yourself',effect:'Gold -35, Gold +20/turn, full control',
     resolve:(g)=>{g.gold-=35;addBuilding('market');g.gold+=10;},
     outcome:'You own the market outright. The profits are entirely yours.',icon:'💰',good:true},
  ]
},
{
  id:'build_barracks',season:-1,minDay:10,maxDay:89,weight:7,
  icon:'⚔',title:'Your General\'s Request',
  body:'Your general has identified a plot of land perfect for a military barracks. Trained soldiers could be produced regularly — strengthening your army for years to come.',
  choices:[
    {text:'Build the barracks (30 gold)',effect:'Gold -30, Army +20, + Barracks',
     resolve:(g)=>{g.gold-=30;g.army+=20;addBuilding('barracks');},
     outcome:'The barracks opens and the sound of training fills the morning air. Your army grows stronger.',icon:'🛡',good:true},
    {text:'Build a watchtower instead',effect:'Gold -15, Army +10, better defence',
     resolve:(g)=>{g.gold-=15;g.army+=10;},
     outcome:'The watchtower provides early warning of any threat. A sound defensive choice.',icon:'🗼'},
    {text:'Not now',effect:'Nothing',
     resolve:(g)=>{},
     outcome:'The land remains empty. Perhaps another time.',icon:'😐'},
  ]
},
{
  id:'comet',season:-1,minDay:15,maxDay:88,weight:4,
  icon:'☄',title:'A Comet in the Sky',
  body:'A blazing comet streaks across the night sky for three days. Your priests call it an omen. Your scholars call it natural. Your people call it terrifying.',
  choices:[
    {text:'Declare it a sign of divine favour',effect:'Happy +20, Army +10',
     resolve:(g)=>{g.happy+=20;g.army+=10;},
     outcome:'Your proclamation turns fear into fervour. Your people march to work singing battle hymns.',icon:'✨',good:true},
    {text:'Consult the scholars',effect:'Happy -5, then +15',
     resolve:(g)=>{g.happy+=10;g.gold+=10;},
     outcome:'The scholars explain it rationally. The fearful are reassured. The curious are delighted.',icon:'🔭'},
    {text:'Lock yourself in the palace',effect:'Happy -15',
     resolve:(g)=>{g.happy-=15;},
     outcome:'Your absence during the panic is noticed and deeply unhelpful. Rumours spread.',icon:'😰',bad:true},
  ]
},
{
  id:'lost_child',season:-1,minDay:5,maxDay:88,weight:5,
  icon:'👦',title:'The Lost Child',
  body:'A small child is found wandering your palace grounds alone. She claims her village was destroyed by raiders. She has nowhere to go.',
  choices:[
    {text:'Take her in as a ward of the crown',effect:'Happy +15, Pop +2, story bonus',
     resolve:(g)=>{g.happy+=15;g.pop+=2;},
     outcome:'The story spreads through the kingdom. You are seen as a ruler with a heart. Your popularity soars.',icon:'❤',good:true},
    {text:'Send soldiers to find her village',effect:'Army -5, Happy +20, Gold +10',
     resolve:(g)=>{g.army-=5;g.happy+=20;g.gold+=10;},
     outcome:'Your soldiers find the village and drive out the raiders. The grateful villagers pledge loyalty and taxes.',icon:'⚔',good:true},
    {text:'Place her with a local family',effect:'Happy +5',
     resolve:(g)=>{g.happy+=5;},
     outcome:'A kind farmer takes her in. Simple and practical.',icon:'🏠'},
  ]
},
{
  id:'eclipse',season:-1,minDay:20,maxDay:80,weight:3,
  icon:'🌑',title:'A Total Eclipse',
  body:'The sun disappears at midday. Darkness falls across your kingdom for three terrifying minutes. Your people are in a panic. What do you do?',
  choices:[
    {text:'Stand before them calmly and speak',effect:'Happy +25, Legendary reputation',
     resolve:(g)=>{g.happy+=25;g.army+=10;},
     outcome:'Your calm presence in the darkness becomes one of the defining moments of your reign. Songs are written about this day.',icon:'👑',good:true},
    {text:'Ring the church bells',effect:'Happy +10',
     resolve:(g)=>{g.happy+=10;},
     outcome:'The familiar sound of the bells comforts your people. The eclipse passes. Life resumes.',icon:'⛪'},
    {text:'Hide — what else can you do?',effect:'Happy -20',
     resolve:(g)=>{g.happy-=20;},
     outcome:'Your disappearance during the eclipse frightens your people more than the eclipse itself.',icon:'😨',bad:true},
  ]
},
{
  id:'treasure_map',season:-1,minDay:15,maxDay:75,weight:5,
  icon:'🗺',title:'A Treasure Map',
  body:'A dying sailor presses a faded map into your hand. It claims to show the location of a buried treasure — immense wealth hidden by a forgotten king.',
  choices:[
    {text:'Send an expedition (20 gold)',effect:'Gold -20',risk:'60% Gold +80, 40% Gold -20',
     resolve:(g)=>{g.gold-=20;if(Math.random()<.6){g.gold+=80;g.happy+=15;}else{g.happy-=5;}},
     outcome:'A gamble worthy of legends. Fortune favours the bold — sometimes.',icon:'🎲',risky:true},
    {text:'Sell the map to a merchant',effect:'Gold +15',
     resolve:(g)=>{g.gold+=15;},
     outcome:'The merchant pays well. You wonder sometimes what was buried there.',icon:'💰'},
    {text:'Ignore it',effect:'Nothing',
     resolve:(g)=>{},
     outcome:'The map gathers dust. Some opportunities only come once.',icon:'😐'},
  ]
},
{
  id:'ancient_ruins',season:-1,minDay:20,maxDay:80,weight:5,
  icon:'🏛',title:'Ancient Ruins Discovered',
  body:'Workers digging foundations for a new building have unearthed ancient ruins — possibly from a civilisation that predates your kingdom by a thousand years.',
  choices:[
    {text:'Excavate carefully (scholars)',effect:'Gold -15, Happy +20, knowledge gained',
     resolve:(g)=>{g.gold-=15;g.happy+=20;g.army+=10;},
     outcome:'The excavation reveals extraordinary artifacts. Your kingdom becomes a centre of learning.',icon:'📜',good:true},
    {text:'Salvage the materials for building',effect:'Gold +20, nothing discovered',
     resolve:(g)=>{g.gold+=20;},
     outcome:'Practical, if unimaginative. The stones go into new walls.',icon:'🧱'},
    {text:'Seal and preserve it as a monument',effect:'Happy +15, Gold +5 (tourism)',
     resolve:(g)=>{g.happy+=15;g.gold+=5;},
     outcome:'People travel from far away to see the ancient site. It becomes part of your kingdom\'s identity.',icon:'🗺',good:true},
  ]
},
];

/* ══════════════════════════════════════════════
   CANVAS RENDERER
   Animated kingdom that grows as you play
══════════════════════════════════════════════ */
const KingdomCanvas = {
  canvas:null, ctx:null, t:0, raf:null,
  particles:[], birds:[], clouds:[],

  init(canvas){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize',()=>this.resize());
    this._spawnParticles();
    this._spawnBirds();
    this._spawnClouds();
    if(this.raf)cancelAnimationFrame(this.raf);
    this.loop();
  },

  resize(){
    if(this.canvas){
      this.canvas.width=window.innerWidth;
      this.canvas.height=window.innerHeight;
    }
  },

  _spawnParticles(){
    this.particles=[];
    for(let i=0;i<40;i++){
      this.particles.push({
        x:Math.random(),y:Math.random()+.5,
        vx:(Math.random()-.5)*.0003,vy:-Math.random()*.0002-.0001,
        r:Math.random()*2+.5,a:Math.random()*.4+.1,
        life:Math.random(),maxLife:Math.random()*3+2,
        col:Math.random()>.5?'rgba(245,200,66,':'rgba(200,134,10,',
      });
    }
  },

  _spawnBirds(){
    this.birds=[];
    for(let i=0;i<6;i++){
      this.birds.push({
        x:Math.random()*1.2-.1,y:Math.random()*.4+.1,
        vx:Math.random()*.0008+.0003,vy:(Math.random()-.5)*.0002,
        wing:Math.random()*Math.PI*2,wingSpeed:Math.random()*.1+.08,
        size:Math.random()*3+2,
      });
    }
  },

  _spawnClouds(){
    this.clouds=[];
    for(let i=0;i<5;i++){
      this.clouds.push({
        x:Math.random(),y:Math.random()*.3+.05,
        w:Math.random()*.25+.12,h:Math.random()*.08+.04,
        speed:Math.random()*.00015+.00005,
        alpha:Math.random()*.25+.08,
      });
    }
  },

  loop(){
    this.raf=requestAnimationFrame(()=>this.loop());
    this.draw();
  },

  draw(){
    const ctx=this.ctx;
    const W=this.canvas.width, H=this.canvas.height;
    this.t+=.012;

    // Sky gradient based on season
    const season=getSeason();
    const skyColors=[
      ['#0a1a05','#1a3a0a','#2a5a15'],// spring
      ['#0a0a05','#1a1505','#3a2a05'],// summer
      ['#080a08','#150f05','#2a1a08'],// autumn
      ['#050810','#0a1220','#102035'],// winter
    ];
    const sc=skyColors[season.idx]||skyColors[0];
    const sky=ctx.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,sc[0]);sky.addColorStop(.5,sc[1]);sky.addColorStop(1,sc[2]);
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);

    // Moon / sun glow
    const isSummer=season.idx===1;
    const glowX=W*.75, glowY=H*.25;
    const sunMoon=ctx.createRadialGradient(glowX,glowY,0,glowX,glowY,W*.35);
    if(isSummer){
      sunMoon.addColorStop(0,'rgba(255,200,50,.12)');
      sunMoon.addColorStop(.5,'rgba(200,150,20,.05)');
    }else{
      sunMoon.addColorStop(0,'rgba(150,180,220,.10)');
      sunMoon.addColorStop(.5,'rgba(100,130,180,.04)');
    }
    sunMoon.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=sunMoon;ctx.fillRect(0,0,W,H);

    // Stars (winter only)
    if(season.idx===3){
      ctx.fillStyle='rgba(255,255,255,.7)';
      for(let i=0;i<60;i++){
        const sx=((i*137+200)%W),sy=((i*97+50)%(H*.4));
        const ss=.5+Math.sin(this.t+i)*.3;
        ctx.globalAlpha=(.3+Math.sin(this.t*.7+i)*.2);
        ctx.beginPath();ctx.arc(sx,sy,ss,0,Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=1;
    }

    // Clouds
    for(const c of this.clouds){
      c.x+=c.speed;if(c.x>1.2)c.x=-0.2;
      ctx.globalAlpha=c.alpha;
      ctx.fillStyle='rgba(220,220,240,1)';
      ctx.beginPath();
      ctx.ellipse(c.x*W,c.y*H,c.w*W*.5,c.h*H*.5,0,0,Math.PI*2);
      ctx.fill();
      ctx.globalAlpha=1;
    }

    // Ground layers
    const numBuildings=G.buildings.length;
    const groundY=H*.65;

    // Far hills
    ctx.fillStyle=season.idx===3?'rgba(50,70,90,.6)':'rgba(30,50,20,.6)';
    ctx.beginPath();ctx.moveTo(0,groundY*.9);
    for(let x=0;x<=W;x+=30){
      const y=groundY*.9-Math.sin(x*.008+1)*H*.12-Math.sin(x*.02)*H*.04;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fill();

    // Mid ground
    ctx.fillStyle=season.idx===3?'rgba(40,60,80,.8)':season.idx===2?'rgba(60,40,20,.8)':'rgba(25,55,15,.8)';
    ctx.beginPath();ctx.moveTo(0,groundY*.95);
    for(let x=0;x<=W;x+=20){
      const y=groundY*.95-Math.sin(x*.012+2)*H*.08-Math.sin(x*.03)*H*.03;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fill();

    // Main ground
    const gc=season.idx===3?['#1a2a35','#243040']:season.idx===2?['#3a2a10','#503820']:['#1a3a08','#264a10'];
    ctx.fillStyle=gc[0];
    ctx.fillRect(0,groundY,W,H-groundY);

    // Ground texture strip
    ctx.fillStyle=gc[1];
    ctx.fillRect(0,groundY,W,6);

    // ── BUILDINGS (grow with progress) ──
    const bldX=W*.12;
    this._drawCastle(ctx,bldX,groundY,numBuildings);

    // Additional buildings based on what player built
    G.buildings.forEach((b,i)=>{
      const bx=W*(.28+i*.1)%(W*.8)+W*.1;
      const by=groundY;
      this._drawBuilding(ctx,b,bx,by,this.t);
    });

    // River
    const riverX=W*.7;
    ctx.strokeStyle='rgba(40,100,160,.5)';
    ctx.lineWidth=8;
    ctx.beginPath();
    ctx.moveTo(riverX,H);
    for(let y=H;y>groundY;y-=10){
      ctx.lineTo(riverX+Math.sin(y*.05+this.t)*.8*W*.03,y);
    }
    ctx.stroke();

    // Trees (forest on right)
    for(let i=0;i<8;i++){
      const tx=W*(.75+i*.032+Math.sin(i*7)*.02);
      const th2=H*(.06+Math.sin(i*3)*.02);
      this._drawTree(ctx,tx,groundY,th2,season.idx);
    }

    // Birds
    for(const b of this.birds){
      b.x+=b.vx;b.y+=b.vy+Math.sin(this.t*b.wingSpeed*3)*.0001;
      if(b.x>1.2){b.x=-.1;b.y=Math.random()*.35+.1;}
      b.wing+=b.wingSpeed;
      ctx.strokeStyle='rgba(150,150,120,.6)';ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.moveTo(b.x*W-b.size*2,b.y*H);
      ctx.quadraticCurveTo(b.x*W-b.size,b.y*H-b.size*Math.sin(b.wing)*1.5,b.x*W,b.y*H);
      ctx.quadraticCurveTo(b.x*W+b.size,b.y*H-b.size*Math.sin(b.wing)*1.5,b.x*W+b.size*2,b.y*H);
      ctx.stroke();
    }

    // Particles (smoke from chimneys etc)
    for(const p of this.particles){
      p.x+=p.vx;p.y+=p.vy;p.life+=.008;
      if(p.life>p.maxLife){p.life=0;p.x=.1+Math.random()*.6;p.y=.55+Math.random()*.1;}
      const a=p.a*(1-p.life/p.maxLife);
      ctx.globalAlpha=a;
      ctx.fillStyle=p.col+'1)';
      ctx.beginPath();ctx.arc(p.x*W,p.y*H,p.r,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;

    // Season overlay
    if(season.idx===3){
      // Snow falling
      ctx.fillStyle='rgba(220,235,255,.7)';
      for(let i=0;i<30;i++){
        const sx=((i*173+this.t*40)%W);
        const sy=((i*97+this.t*30)%H);
        ctx.globalAlpha=.4+Math.sin(this.t+i)*.2;
        ctx.beginPath();ctx.arc(sx,sy,1.5,0,Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=1;
    }
    if(season.idx===2){
      // Falling leaves
      ctx.fillStyle='rgba(180,80,20,.6)';
      for(let i=0;i<15;i++){
        const sx=((i*193+this.t*20)%W);
        const sy=((i*131+this.t*25+Math.sin(this.t+i)*20)%H);
        ctx.globalAlpha=.3+Math.sin(this.t*.5+i)*.2;
        ctx.fillRect(sx,sy,4,4);
      }
      ctx.globalAlpha=1;
    }
  },

  _drawCastle(ctx,x,y,level){
    const W=this.canvas.width,H=this.canvas.height;
    const s=Math.min(1,0.4+level*.12); // grows with progress
    const h=H*.22*s;
    const w=W*.14*s;

    // Base
    ctx.fillStyle='#3a3028';
    ctx.fillRect(x-w/2,y-h,w,h);
    // Left tower
    ctx.fillStyle='#4a3830';
    ctx.fillRect(x-w/2-w*.2,y-h*.85,w*.22,h*.85);
    // Right tower
    ctx.fillRect(x+w/2-w*.02,y-h*.85,w*.22,h*.85);
    // Battlements
    ctx.fillStyle='#5a4840';
    const bw=w*.08;
    for(let i=-3;i<=3;i+=2){ctx.fillRect(x+i*bw*1.1-bw/2,y-h-bw*.8,bw,bw*.8);}
    for(let i=-1;i<=1;i+=2){
      const tx=x+(i<0?-w/2-w*.2:w/2-w*.02);
      for(let j=-2;j<=2;j+=2){ctx.fillRect(tx+j*bw*.6,y-h*.85-bw*.6,bw*.7,bw*.6);}
    }
    // Gate
    ctx.fillStyle='#1a1008';
    ctx.fillRect(x-bw,y-h*.35,bw*2,h*.35);
    // Flag
    if(level>0){
      ctx.strokeStyle='#8a6020';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(x,y-h);ctx.lineTo(x,y-h-h*.25);ctx.stroke();
      ctx.fillStyle='#d94a4a';
      ctx.beginPath();ctx.moveTo(x,y-h-h*.25);ctx.lineTo(x+w*.12,y-h-h*.18);ctx.lineTo(x,y-h-h*.11);ctx.closePath();ctx.fill();
    }
    // Windows
    ctx.fillStyle='rgba(245,200,66,.3)';
    ctx.fillRect(x-w*.12,y-h*.6,w*.1,w*.1);
    ctx.fillRect(x+w*.02,y-h*.6,w*.1,w*.1);
  },

  _drawBuilding(ctx,b,x,y,t){
    const icons={'farm':'🌾','market':'🏪','barracks':'⚔','tavern':'🍺',
                 'library':'📚','cathedral':'⛪','forge':'🔨','granary':'🌽',
                 'treasury':'💰','walls':'🧱','harbour':'⚓','palace':'🏰'};
    const ic=icons[b.id]||'🏗';
    const sz=Math.max(18,22+Math.sin(t+x)*.5);
    ctx.font=`${sz}px sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.globalAlpha=.85;
    ctx.fillText(ic,x,y);
    ctx.globalAlpha=1;
  },

  _drawTree(ctx,x,y,h,season){
    ctx.fillStyle=season===2?'#8a4010':season===3?'rgba(180,200,220,.4)':'#1a5010';
    ctx.beginPath();
    ctx.moveTo(x,y-h);ctx.lineTo(x+h*.4,y);ctx.lineTo(x-h*.4,y);ctx.closePath();ctx.fill();
    if(season!==3){
      ctx.fillStyle=season===2?'#6a3008':'#0e3808';
      ctx.beginPath();
      ctx.moveTo(x,y-h*1.3);ctx.lineTo(x+h*.28,y-h*.5);ctx.lineTo(x-h*.28,y-h*.5);ctx.closePath();ctx.fill();
    }
  },

  stop(){if(this.raf){cancelAnimationFrame(this.raf);this.raf=null;}},
};

/* ══════════════════════════════════════════════
   HOME SCREEN ANIMATION
══════════════════════════════════════════════ */
const HomeAnim={
  canvas:null,ctx:null,t:0,raf:null,pts:[],
  init(){
    this.canvas=document.getElementById('home-canvas');
    if(!this.canvas)return;
    this.ctx=this.canvas.getContext('2d');
    this.resize();window.addEventListener('resize',()=>this.resize());
    this.pts=[];
    for(let i=0;i<50;i++)this.pts.push({
      x:Math.random(),y:Math.random(),
      vx:(Math.random()-.5)*.00015,vy:-Math.random()*.0001,
      r:Math.random()*1.8+.4,a:Math.random()*.45+.1,
      col:Math.random()>.4?'rgba(245,200,66,':'rgba(200,134,10,',
    });
    if(this.raf)cancelAnimationFrame(this.raf);
    this.loop();
  },
  resize(){if(this.canvas){this.canvas.width=window.innerWidth;this.canvas.height=window.innerHeight;}},
  loop(){this.raf=requestAnimationFrame(()=>this.loop());this.draw();},
  draw(){
    if(!this.ctx)return;
    const ctx=this.ctx,W=this.canvas.width,H=this.canvas.height;
    this.t+=.007;
    const bg=ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0,'#020301');bg.addColorStop(.5,'#060401');bg.addColorStop(1,'#0a0601');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    // Kingdom silhouette
    ctx.fillStyle='rgba(15,10,3,.9)';
    ctx.beginPath();ctx.moveTo(0,H*.65);
    // Castle silhouette
    const cx=W*.3;
    ctx.lineTo(cx-W*.12,H*.65);ctx.lineTo(cx-W*.12,H*.42);
    ctx.lineTo(cx-W*.09,H*.42);ctx.lineTo(cx-W*.09,H*.38);
    ctx.lineTo(cx-W*.06,H*.38);ctx.lineTo(cx-W*.06,H*.42);
    ctx.lineTo(cx-W*.03,H*.42);ctx.lineTo(cx-W*.03,H*.3);
    ctx.lineTo(cx+W*.03,H*.3);ctx.lineTo(cx+W*.03,H*.42);
    ctx.lineTo(cx+W*.06,H*.42);ctx.lineTo(cx+W*.06,H*.38);
    ctx.lineTo(cx+W*.09,H*.38);ctx.lineTo(cx+W*.09,H*.42);
    ctx.lineTo(cx+W*.12,H*.42);ctx.lineTo(cx+W*.12,H*.65);
    // Trees
    for(let i=0;i<8;i++){
      const tx=W*.52+i*W*.065;
      const th=H*.1+Math.sin(i*3)*.05*H;
      ctx.lineTo(tx-W*.025,H*.65);ctx.lineTo(tx,H*.65-th);ctx.lineTo(tx+W*.025,H*.65);
    }
    ctx.lineTo(W,H*.65);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fill();
    // Stars
    for(const p of this.pts){
      p.x+=p.vx;p.y+=p.vy;
      if(p.x<0)p.x=1;if(p.x>1)p.x=0;if(p.y<0)p.y=.8;
      ctx.beginPath();ctx.arc(p.x*W,p.y*H,p.r,0,Math.PI*2);
      ctx.fillStyle=p.col+(p.a*(.7+Math.sin(this.t*2+p.x*10)*.3))+')';
      ctx.fill();
    }
    // Warm glow from castle
    const gl=ctx.createRadialGradient(cx,H*.5,0,cx,H*.5,W*.4);
    gl.addColorStop(0,`rgba(245,150,20,${.08+Math.sin(this.t)*.02})`);
    gl.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gl;ctx.fillRect(0,0,W,H);
  },
  stop(){if(this.raf){cancelAnimationFrame(this.raf);this.raf=null;}},
};

/* ══════════════════════════════════════════════
   HELPER FUNCTIONS
══════════════════════════════════════════════ */
function getSeason(){
  for(let i=0;i<SEASONS.length;i++){
    const s=SEASONS[i];
    if(G.day>=s.days[0]&&G.day<=s.days[1])return{...s,idx:i};
  }
  return{...SEASONS[3],idx:3};
}

function addBuilding(id){
  if(!BUILDINGS[id])return;
  if(!G.buildings.find(b=>b.id===id)){
    G.buildings.push(BUILDINGS[id]);
  }
}

function hasBuilding(id){return G.buildings.some(b=>b.id===id);}

function clampStats(){
  G.gold  =Math.max(0,Math.min(MAX_STAT,Math.round(G.gold)));
  G.food  =Math.max(0,Math.min(MAX_STAT,Math.round(G.food)));
  G.army  =Math.max(0,Math.min(MAX_STAT,Math.round(G.army)));
  G.happy =Math.max(0,Math.min(MAX_STAT,Math.round(G.happy)));
  G.pop   =Math.max(0,Math.min(MAX_STAT,Math.round(G.pop)));
}

function calcScore(){
  return Math.floor(G.gold*.5+G.food*.4+G.army*.6+G.happy*.8+G.pop*1.0+G.buildings.length*30+G.achievements.length*50+G.day*2);
}

function getStatColor(val,max){
  const p=val/max;
  if(p>.6)return '#4ad94a';
  if(p>.3)return '#f5c842';
  return '#d94a4a';
}

/* ══════════════════════════════════════════════
   SAVE / LOAD
══════════════════════════════════════════════ */
const Save={
  save(){
    try{
      G.score=calcScore();
      localStorage.setItem(SAVE_KEY,JSON.stringify(G));
      // Update meta
      const meta=this.getMeta();
      meta.last_played=new Date().toDateString();
      meta.total_runs=G.total_runs;
      meta.best_score=Math.max(meta.best_score||0,G.score);
      meta.all_achievements=[...new Set([...(meta.all_achievements||[]),...G.achievements])];
      localStorage.setItem(META_KEY,JSON.stringify(meta));
    }catch(e){console.warn('Save failed',e);}
  },
  load(){
    try{
      const raw=localStorage.getItem(SAVE_KEY)||window.SHORTCUTS_SAVE;
      if(!raw)return false;
      const d=JSON.parse(raw);
      Object.assign(G,d);
      return true;
    }catch(e){return false;}
  },
  getMeta(){
    try{return JSON.parse(localStorage.getItem(META_KEY))||{};}
    catch(e){return{};}
  },
  clear(){localStorage.removeItem(SAVE_KEY);},
};

/* ══════════════════════════════════════════════
   DAILY PASSIVE INCOME
   Buildings produce resources each day
══════════════════════════════════════════════ */
function applyDailyIncome(){
  if(hasBuilding('farm'))     G.food +=5;
  if(hasBuilding('market'))   G.gold +=8;
  if(hasBuilding('barracks')) G.army +=6;
  if(hasBuilding('tavern'))   G.happy+=5;
  if(hasBuilding('forge'))    G.army +=10;
  if(hasBuilding('cathedral'))G.happy+=8;
  if(hasBuilding('harbour'))  G.gold +=12;
  if(hasBuilding('palace'))   {G.gold+=3;G.food+=3;G.army+=3;G.happy+=3;G.pop+=2;}
  // Natural decay
  G.food  -=Math.ceil(G.pop*.03);   // population eats food
  G.gold  -=Math.ceil(G.army*.02);  // army costs gold
  G.happy -=1;                       // happiness naturally decays without effort
  // Population growth
  if(G.food>60&&G.happy>50) G.pop+=Math.floor(Math.random()*3);
  // Gold from trade (small baseline)
  G.gold+=3;
}

/* ══════════════════════════════════════════════
   ACHIEVEMENT SYSTEM
══════════════════════════════════════════════ */
let _happyDays=0;
let _lowGoldRecovered=false;
let _noWar=true;

function checkAchievements(){
  if(G.happy>=90)_happyDays++;else _happyDays=0;
  if(G.gold<=10&&G.day>5)_lowGoldRecovered=true;

  for(const a of ACHIEVEMENTS){
    if(G.achievements.includes(a.id))continue;
    let earned=false;
    if(a.check&&a.check())earned=true;
    if(a.id==='beloved'&&_happyDays>=10)earned=true;
    if(a.id==='survivor'&&_lowGoldRecovered&&G.gold>50)earned=true;
    if(a.id==='comeback'&&_lowGoldRecovered&&G.gold>80)earned=true;
    if(a.id==='peacekeeper'&&G.day>=TOTAL_DAYS&&_noWar)earned=true;
    if(earned){
      G.achievements.push(a.id);
      showAchievement(a);
    }
  }
}

function showAchievement(a){
  const el=document.getElementById('ach-popup');
  document.getElementById('ach-popup-icon').textContent=a.icon;
  document.getElementById('ach-popup-name').textContent=a.name;
  document.getElementById('ach-popup-desc').textContent=a.desc;
  el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'),3500);
}

/* ══════════════════════════════════════════════
   HUD UPDATER
══════════════════════════════════════════════ */
function updateHUD(){
  clampStats();
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  const bar=(id,v)=>{
    const el=document.getElementById(id);
    if(el){el.style.width=`${(v/MAX_STAT)*100}%`;el.style.background=getStatColor(v,MAX_STAT);}
  };
  set('v-gold',G.gold); bar('bar-gold',G.gold);
  set('v-food',G.food); bar('bar-food',G.food);
  set('v-army',G.army); bar('bar-army',G.army);
  set('v-happy',G.happy);bar('bar-happy',G.happy);
  set('v-pop',G.pop);   bar('bar-pop',G.pop);

  const season=getSeason();
  set('day-label',`Day ${G.day}`);
  set('season-name',season.name);
  document.getElementById('season-icon').textContent=season.icon;

  // Progress bar
  const pct=(G.day/TOTAL_DAYS)*100;
  const pf=document.getElementById('progress-fill');
  if(pf){pf.style.width=`${pct}%`;pf.style.background=season.color;}
  set('progress-label',`${season.name} · Year ${Math.ceil(G.day/30)} of 3`);

  // Score
  G.score=calcScore();
  set('sb-score',G.score);
  set('sb-kingdom-name',G.name);

  // Buildings sidebar
  const bldEl=document.getElementById('sb-buildings');
  if(bldEl){
    bldEl.innerHTML=G.buildings.map(b=>`<div class="sb-bld"><span class="sb-bld-icon">${b.icon}</span>${b.name}</div>`).join('');
  }

  // Achievements
  const achEl=document.getElementById('ach-list');
  if(achEl){
    achEl.innerHTML=ACHIEVEMENTS.map(a=>{
      const earned=G.achievements.includes(a.id)||G.all_achievements?.includes(a.id);
      return`<div class="ach-item${earned?'':' locked'}"><span class="ach-icon">${a.icon}</span><span class="ach-name">${a.name}</span></div>`;
    }).join('');
  }
}

/* ══════════════════════════════════════════════
   EVENT ENGINE
══════════════════════════════════════════════ */
let currentEvent=null;

function pickEvent(){
  const season=getSeason();
  // Filter valid events
  let pool=EVENTS.filter(e=>{
    if(G.events_seen.includes(e.id)&&e.weight<8)return false; // don't repeat rare events
    if(e.minDay>G.day||e.maxDay<G.day)return false;
    if(e.season!==-1&&e.season!==season.idx)return false;
    return true;
  });
  if(!pool.length)pool=EVENTS.filter(e=>e.minDay<=G.day&&e.maxDay>=G.day);
  if(!pool.length)return null;
  // Weighted random
  const total=pool.reduce((s,e)=>s+e.weight,0);
  let r=Math.random()*total;
  for(const e of pool){r-=e.weight;if(r<=0)return e;}
  return pool[pool.length-1];
}

function showEvent(ev){
  currentEvent=ev;
  G.events_seen.push(ev.id);

  const season=getSeason();
  const panel=document.getElementById('event-panel');
  panel.classList.remove('hidden');

  const tag=document.getElementById('ep-season-tag');
  tag.textContent=season.name.toUpperCase();
  tag.style.background=season.color;

  document.getElementById('ep-icon').textContent=ev.icon;
  document.getElementById('ep-title').textContent=ev.title;
  document.getElementById('ep-body').textContent=ev.body;

  const effEl=document.getElementById('ep-effect');
  effEl.classList.add('hidden');

  // Build choices
  const choicesEl=document.getElementById('ep-choices');
  choicesEl.innerHTML='';
  ev.choices.forEach((c,i)=>{
    // Check requirements
    if(c.requires&&!hasBuilding(c.requires)){
      const btn=document.createElement('button');
      btn.className='choice-btn';
      btn.style.opacity='.35';btn.disabled=true;
      btn.innerHTML=`<span class="choice-main">${c.text}</span><span class="choice-effect">${c.effect}</span><span class="choice-risk">🔒 ${c.requireText||'Requirement not met'}</span>`;
      choicesEl.appendChild(btn);
      return;
    }
    const btn=document.createElement('button');
    btn.className=`choice-btn${c.good?' good':c.bad?' bad':c.risky?' risky':''}`;
    btn.innerHTML=`<span class="choice-main">${c.text}</span>
      <span class="choice-effect">${c.effect}</span>
      ${c.risk?`<span class="choice-risk">⚠ ${c.risk}</span>`:''}`;
    btn.addEventListener('click',()=>resolveChoice(ev,c));
    choicesEl.appendChild(btn);
  });

  document.getElementById('ep-skip').classList.add('hidden');
}

function resolveChoice(ev,choice){
  // Apply the effect
  const before={gold:G.gold,food:G.food,army:G.army,happy:G.happy,pop:G.pop};
  choice.resolve(G);
  clampStats();

  // Calculate actual changes
  const changes=[
    {key:'gold',icon:'⚜',label:'Gold'},
    {key:'food',icon:'🌾',label:'Food'},
    {key:'army',icon:'⚔',label:'Army'},
    {key:'happy',icon:'❤',label:'Happiness'},
    {key:'pop',icon:'👥',label:'Population'},
  ].filter(s=>Math.abs(G[s.key]-before[s.key])>0);

  // Record history
  G.history.push({day:G.day,event:ev.title,choice:choice.text,icon:choice.icon||'📜'});

  // Show outcome
  showOutcome(choice,changes);

  // Hide event panel
  document.getElementById('event-panel').classList.add('hidden');
}

function showOutcome(choice,changes){
  const panel=document.getElementById('outcome-panel');
  panel.classList.remove('hidden');

  document.getElementById('op-icon').textContent=choice.icon||'📜';
  document.getElementById('op-title').textContent=choice.good?'A wise decision!':choice.bad?'A costly mistake...':'The deed is done.';
  document.getElementById('op-body').textContent=choice.outcome||'Your decision has been made.';

  const effEl=document.getElementById('op-effects');
  effEl.innerHTML=changes.map(c=>{
    const diff=G[c.key]-Math.max(0,G[c.key]); // this gets overwritten
    const before_val=G[c.key]-(G[c.key]-G[c.key]); // unused
    return '';
  }).join('');

  // Calculate changes properly
  effEl.innerHTML='';
  if(changes.length===0){
    effEl.innerHTML='<div class="effect-chip effect-neu">No immediate change</div>';
  }

  updateHUD();
  checkAchievements();

  // Addiction mechanic: show near-miss warning
  if(G.gold<15||G.food<10||G.happy<15){
    setTimeout(()=>toast('⚠️ Warning: Your kingdom is in danger!'),800);
  }
}

function advanceDay(){
  // Move to next event
  document.getElementById('outcome-panel').classList.add('hidden');

  // Apply daily income
  applyDailyIncome();
  G.day++;

  // Check for game over
  if(checkGameOver())return;

  // Check for victory
  if(G.day>TOTAL_DAYS){
    showVictory();return;
  }

  // Save
  Save.save();
  updateHUD();

  // Pick and show next event
  const ev=pickEvent();
  if(ev){showEvent(ev);}
  else{
    // Rest day — small recovery
    G.happy+=3;G.gold+=2;
    clampStats();updateHUD();
    showRestDay();
  }
}

function showRestDay(){
  const panel=document.getElementById('event-panel');
  panel.classList.remove('hidden');
  document.getElementById('ep-icon').textContent='🌅';
  document.getElementById('ep-title').textContent='A Quiet Day';
  document.getElementById('ep-body').textContent='The kingdom is at peace today. Your people go about their lives. A rare moment of calm.';
  document.getElementById('ep-choices').innerHTML='';
  document.getElementById('ep-skip').classList.remove('hidden');
}

function checkGameOver(){
  if(G.gold<=0&&G.day>5){
    endGame('bankruptcy','Your treasury is empty. Creditors seize your palace. Your kingdom dissolves into chaos.');
    return true;
  }
  if(G.food<=0&&G.pop>10){
    endGame('famine','Famine sweeps the kingdom. Without food, your people scatter to the winds.');
    return true;
  }
  if(G.happy<=0){
    endGame('revolt','Your people rise in revolt. The palace is stormed. Your reign ends in flames.');
    return true;
  }
  if(G.army<=0&&G.day>30){
    endGame('conquest','With no army to defend them, your borders collapse. Rivals carve up your kingdom.');
    return true;
  }
  return false;
}

function endGame(reason,msg){
  G.score=calcScore();
  G.total_runs++;
  Save.save();
  Save.clear(); // Remove active save

  document.getElementById('game').classList.add('hidden');

  const screen=document.getElementById('gameover');
  screen.classList.remove('hidden');
  document.getElementById('go-reason').textContent=msg;
  document.getElementById('go-score-big').textContent=`Legacy Score: ${G.score}`;
  document.getElementById('go-stats').innerHTML=
    `<div class="go-stat"><span>Reign Length</span><span>Day ${G.day}</span></div>
     <div class="go-stat"><span>Gold</span><span>${G.gold}</span></div>
     <div class="go-stat"><span>Population</span><span>${G.pop}</span></div>
     <div class="go-stat"><span>Buildings</span><span>${G.buildings.length}</span></div>
     <div class="go-stat"><span>Achievements</span><span>${G.achievements.length}/${ACHIEVEMENTS.length}</span></div>`;

  const meta=Save.getMeta();
  const best=Math.max(meta.best_score||0,G.score);
  if(G.score>=best){
    document.getElementById('go-title').textContent='A Valiant Attempt — New Record!';
  }
}

function showVictory(){
  G.score=calcScore();
  G.total_runs++;
  const a=ACHIEVEMENTS.find(a=>a.id==='first_win');
  if(a&&!G.achievements.includes(a.id)){G.achievements.push(a.id);}
  Save.save();Save.clear();

  document.getElementById('game').classList.add('hidden');
  const screen=document.getElementById('victory');
  screen.classList.remove('hidden');

  const title=G.score>600?'A Legendary Reign!':G.score>400?'A Great Ruler':' A Worthy Ruler';
  document.getElementById('vic-title').textContent=title;
  document.getElementById('vic-body').textContent=`${G.name} will be remembered for generations. Historians will debate the secrets of your success. The people built statues in your honour.`;
  document.getElementById('vic-score-big').textContent=`Legacy Score: ${G.score}`;
  document.getElementById('vic-stats').innerHTML=
    `<div class="go-stat"><span>Reign</span><span>${TOTAL_DAYS} days — COMPLETE</span></div>
     <div class="go-stat"><span>Final Gold</span><span>${G.gold}</span></div>
     <div class="go-stat"><span>Final Population</span><span>${G.pop}</span></div>
     <div class="go-stat"><span>Buildings</span><span>${G.buildings.length}</span></div>
     <div class="go-stat"><span>Achievements</span><span>${G.achievements.length}/${ACHIEVEMENTS.length}</span></div>`;
}

/* ══════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════ */
let _toastTimer=null;
function toast(msg,dur){
  dur=dur||2500;
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.add('hidden'),dur);
}

/* ══════════════════════════════════════════════
   STREAK SYSTEM
══════════════════════════════════════════════ */
function checkStreak(){
  const meta=Save.getMeta();
  const today=new Date().toDateString();
  const last=meta.last_played;
  const yesterday=new Date(Date.now()-86400000).toDateString();

  if(last===today){
    // Same day — streak intact
    G.streak=meta.streak||1;
  }else if(last===yesterday){
    // Consecutive day — increment
    G.streak=(meta.streak||0)+1;
    if(G.streak>=2){showStreakBanner(G.streak);}
  }else{
    // Streak broken
    G.streak=1;
  }
}

function showStreakBanner(n){
  const el=document.getElementById('streak-banner');
  document.getElementById('streak-banner-text').textContent=`${n} day streak! +10 Gold bonus`;
  el.classList.remove('hidden');
  G.gold+=10;
  setTimeout(()=>el.classList.add('hidden'),3000);
}

/* ══════════════════════════════════════════════
   MAIN GAME CONTROLLER
══════════════════════════════════════════════ */
function startNewGame(){
  // Reset state
  Object.assign(G,{
    gold:100,food:80,army:20,happy:75,pop:50,
    day:1,score:0,
    name:KINGDOM_NAMES[Math.floor(Math.random()*KINGDOM_NAMES.length)]+' '+['Kingdom','Empire','Realm','Dominion','Crown'][Math.floor(Math.random()*5)],
    buildings:[],achievements:[],events_seen:[],
    pending_event:null,history:[],
  });

  // Inherit streak from meta
  const meta=Save.getMeta();
  G.streak=meta.streak||0;
  G.total_runs=(meta.total_runs||0);
  G.all_achievements=meta.all_achievements||[];

  document.getElementById('home').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  HomeAnim.stop();

  const kc=document.getElementById('kingdom-canvas');
  KingdomCanvas.init(kc);

  updateHUD();
  Save.save();

  // First event
  setTimeout(()=>{
    const ev=pickEvent();
    if(ev)showEvent(ev);
  },600);
}

function continueGame(){
  if(!Save.load()){
    toast('No saved kingdom found. Start a new game!');
    const b=document.getElementById('btn-new');
    b.style.boxShadow='0 0 0 3px #f5c842';
    setTimeout(()=>b.style.boxShadow='',2000);
    return;
  }

  document.getElementById('home').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  HomeAnim.stop();

  const kc=document.getElementById('kingdom-canvas');
  KingdomCanvas.init(kc);

  checkStreak();
  updateHUD();

  const ev=pickEvent();
  if(ev)showEvent(ev);
  else showRestDay();
}

function goHome(){
  KingdomCanvas.stop();
  document.getElementById('game').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('home').classList.remove('hidden');
  loadHomeScreen();
  HomeAnim.init();
}

function loadHomeScreen(){
  const meta=Save.getMeta();
  const hasSave=!!localStorage.getItem(SAVE_KEY);

  // Streak
  const streak=meta.streak||0;
  if(streak>=2){
    document.getElementById('home-streak').classList.remove('hidden');
    document.getElementById('streak-text').textContent=`${streak} day streak!`;
  }

  // Records
  if(meta.total_runs>0){
    document.getElementById('home-records').classList.remove('hidden');
    document.getElementById('rec-best').textContent=meta.best_score||0;
    document.getElementById('rec-runs').textContent=meta.total_runs||0;
  }

  // Continue button
  const cont=document.getElementById('btn-continue');
  cont.style.opacity=hasSave?'1':'0.4';
}

/* ══════════════════════════════════════════════
   WIRE BUTTONS
══════════════════════════════════════════════ */
function wireButtons(){
  document.getElementById('btn-new')      ?.addEventListener('click',startNewGame);
  document.getElementById('btn-continue') ?.addEventListener('click',continueGame);
  document.getElementById('btn-next-event')?.addEventListener('click',advanceDay);
  document.getElementById('btn-skip')     ?.addEventListener('click',()=>{
    document.getElementById('event-panel').classList.add('hidden');
    advanceDay();
  });
  document.getElementById('btn-pause')    ?.addEventListener('click',()=>{
    document.getElementById('pause-menu').classList.remove('hidden');
    document.getElementById('pm-kingdom').textContent=G.name+' · Day '+G.day;
  });
  document.getElementById('btn-resume')   ?.addEventListener('click',()=>document.getElementById('pause-menu').classList.add('hidden'));
  document.getElementById('btn-save-manual')?.addEventListener('click',()=>{Save.save();toast('💾 Kingdom saved!');});
  document.getElementById('btn-abandon')  ?.addEventListener('click',()=>{
    if(confirm('Abandon this kingdom? This cannot be undone.')){
      Save.clear();goHome();
    }
  });
  document.getElementById('btn-pm-home')  ?.addEventListener('click',()=>{Save.save();goHome();});
  document.getElementById('btn-menu')     ?.addEventListener('click',()=>{
    document.getElementById('pause-menu').classList.remove('hidden');
    document.getElementById('pm-kingdom').textContent=G.name+' · Day '+G.day;
  });
  document.getElementById('btn-go-home')  ?.addEventListener('click',goHome);
  document.getElementById('btn-vic-home') ?.addEventListener('click',goHome);
}

/* ══════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════ */
function init(){
  wireButtons();
  loadHomeScreen();
  HomeAnim.init();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}

})();
