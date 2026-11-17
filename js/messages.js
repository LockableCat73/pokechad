/**
 * The words PokéChad says when a stopwatch starts and every 45 minutes after.
 * Data only; js/encourage.js decides which line is used.
 *
 * Three pools, from the widest to the most specific:
 *
 *   GENERAL     lines that suit any Pokémon
 *   BY_TYPE     lines for a Pokémon of a given type (a dual type draws from
 *               both). New Pokémon get these automatically, because their
 *               types come from data/pokedex.json.
 *   BY_POKEMON  lines written for one well-known Pokémon, keyed by its slug
 *               in data/pokedex.json. Hand-written easter eggs: a Pokémon
 *               with no entry here simply uses the other two pools.
 *
 * Every pool is split by the kind of session. "chad" lines encourage.
 * "chud" lines are meant to put you off: playful guilt, never cruel.
 *
 * In GENERAL and BY_TYPE, {name} is replaced by the Pokémon's name ("Alolan
 * Vulpix"). BY_POKEMON lines spell the name out themselves.
 *
 * GENERAL is also split by moment: "start" when the stopwatch starts,
 * "reminder" every 45 minutes. The other two pools are written to work at
 * either moment.
 *
 * Adding a line is just adding a string to a list. tests/logic.test.js
 * checks that every type and every Pokémon named here exists in the data.
 */

export const GENERAL = {
  chad: {
    start: [
      "Let's do this! {name} is with you.",
      "Let's go! {name} is ready when you are.",
      'Time to lock in. {name} believes in you.',
      "{name} wants to battle! Let's do this.",
      'A wild task appeared! Go, {name}!',
      '{name}, I choose you! Now get to work.',
      'New session, new high score. {name} is watching.',
      "{name} is fired up. Show them what you've got.",
    ],
    reminder: [
      '{name} is cheering you on. Keep going!',
      '{name} believes in you. Stay locked in.',
      '{name} is proud of you. One more push!',
      'Still going strong. {name} is impressed.',
      '{name} says the multiplier is only getting better.',
      'Great focus. {name} is right beside you.',
      '{name} used Helping Hand! Keep it up.',
      "It's super effective! {name} can't look away.",
      'Critical hit! {name} felt that one.',
      'Your focus rose sharply! {name} noticed.',
      'You are on a roll. The next Pokémon is getting closer.',
    ],
  },
  chud: {
    start: [
      'Really? {name} expected better.',
      '{name} just sighed. Loudly.',
      '{name} is watching you waste this.',
      'Every minute here costs you points. {name} is counting.',
      'Your next Pokémon just got further away.',
      "{name} looked away. It can't watch.",
      'Chud time. {name} is already disappointed.',
      'You could have pressed the other button. {name} knows.',
    ],
    reminder: [
      '{name} is disappointed. Still here?',
      "It's not very effective... {name} agrees.",
      '{name} could have evolved in the time you just wasted.',
      'That is points gone for good. {name} saw all of it.',
      'The score is dropping. {name} is not impressed.',
      '{name} asked when you plan to do something useful.',
      'You are hurt by your own laziness! {name} winced.',
      '{name} is loafing around... no wait, that is you.',
      'But nothing happened! {name} is still waiting.',
      'Your motivation fell! {name} wants it back.',
    ],
  },
};

/** Used while the player holds no Pokémon at all. No {name} in these. */
export const NO_POKEMON = {
  chad: {
    start: ["Let's do this! Your first Pokémon is waiting.", 'Time to lock in. The first point is the hardest.'],
    reminder: ['Still going strong. Keep it up!', 'Great focus. The multiplier is climbing.'],
  },
  chud: {
    start: ['Really? You are better than this.', 'Chud time. Your first Pokémon just got further away.'],
    reminder: ['Still here? The score is dropping.', 'That is a lot of points gone.'],
  },
};

export const BY_TYPE = {
  normal: {
    chad: [
      'Nothing fancy, just solid work. {name} approves.',
      'Steady and reliable. {name} would know.',
      "{name} used Work Up! It's working.",
    ],
    chud: ['{name} used Yawn. You fell for it.', '{name} is a Normal type. This is not normal.'],
  },
  fire: {
    chad: [
      'You are on fire! {name} approves.',
      'Burning through it. {name} can feel the heat.',
      '{name} used Flame Charge! Your speed rose.',
    ],
    chud: ["{name}'s flame is going out watching this.", 'Total burnout, and {name} did not even use a move.'],
  },
  water: {
    chad: [
      'Riding the wave. {name} is surfing right beside you.',
      'In the flow. {name} would not change a thing.',
      'Making a splash! {name} is soaked and happy.',
    ],
    chud: ['{name} says you are all washed up.', 'Treading water. {name} is bored.'],
  },
  electric: {
    chad: [
      'Fully charged! {name} can feel the current.',
      'Sparks are flying. {name} loves it.',
      'High voltage focus. {name} is buzzing.',
    ],
    chud: ['Battery low. {name} is not going to recharge you.', 'No spark at all. {name} checked twice.'],
  },
  grass: {
    chad: [
      'Growing nicely. {name} loves the progress.',
      'Deep roots, steady growth. {name} is proud.',
      '{name} used Growth! So did you.',
    ],
    chud: [
      '{name} is watching the weeds grow. So are you.',
      'Touch grass, they said. {name} did not mean like this.',
    ],
  },
  ice: {
    chad: [
      'Ice cold focus. {name} respects it.',
      'Cool, calm, productive. {name} approves.',
      'Not even a shiver. {name} is impressed.',
    ],
    chud: ['Frozen solid, and not in the good way. {name} is waiting.', '{name} has seen glaciers move faster.'],
  },
  fighting: {
    chad: [
      'Another rep! {name} is spotting you.',
      'No pain, no gain. {name} is flexing.',
      '{name} used Bulk Up! Your focus rose.',
    ],
    chud: ['{name} trains every day. You? Not today.', 'Skipping practice again. {name} noticed.'],
  },
  poison: {
    chad: [
      'Toxic levels of productivity. {name} is into it.',
      'Slow and sure, like poison. {name} approves.',
      '{name} calls this a healthy habit. Rare praise.',
    ],
    chud: [
      'This habit is toxic. Even {name} thinks so.',
      'You are badly poisoned by procrastination. {name} has no Antidote.',
    ],
  },
  ground: {
    chad: [
      'Feet on the ground. {name} digs it.',
      'Breaking new ground. {name} is right behind you.',
      '{name} used Dig! Deep work it is.',
    ],
    chud: ['{name} dug a hole. You are still in yours.', 'Stuck in the mud. {name} is not pulling you out.'],
  },
  flying: {
    chad: [
      'You are flying through this! {name} can barely keep up.',
      'Sky high. {name} is soaring with you.',
      '{name} used Tailwind! Everything is faster.',
    ],
    chud: ['{name} is circling, waiting for you to move.', 'Grounded. {name} is embarrassed for you.'],
  },
  psychic: {
    chad: [
      '{name} foresaw this. Total focus.',
      'Mind over matter. {name} is impressed.',
      '{name} used Calm Mind! It shows.',
    ],
    chud: ['{name} read your mind. There was nothing in it.', '{name} predicted this. It hoped to be wrong.'],
  },
  bug: {
    chad: [
      'Busy as a Beedrill. {name} approves.',
      'Small steps, big swarm. {name} is with you.',
      '{name} says you are about to evolve early.',
    ],
    chud: ['Bugs evolve by level 10. What have you done lately? {name} is asking.', 'Bugging out again. {name} saw.'],
  },
  rock: {
    chad: [
      'Rock solid. {name} is impressed.',
      'Unmovable focus. {name} respects it.',
      '{name} used Rock Polish! Speed rose sharply.',
    ],
    chud: ['{name} has moved more than you today. It is a rock.', 'Dead weight. {name} would know.'],
  },
  ghost: {
    chad: [
      'Scary good. {name} is haunted by your focus.',
      'Frighteningly productive. {name} approves.',
      "{name} vanished... no, it just can't keep up with you.",
    ],
    chud: ['{name} has seen more life in a graveyard.', 'Your goals are ghosting you back. {name} checked.'],
  },
  dragon: {
    chad: [
      'A legendary effort. {name} roars in approval.',
      'Dragon-level focus. {name} is proud.',
      '{name} used Dragon Dance! Attack and speed rose.',
    ],
    chud: [
      '{name} expected a dragon. It got a Magikarp.',
      '{name} sleeps on a hoard of points. Yours is shrinking.',
    ],
  },
  dark: {
    chad: [
      'Working in the shadows. {name} respects the grind.',
      'Nasty Plot, great execution. {name} approves.',
      'Nobody sees the work. {name} does.',
    ],
    chud: ['{name} did not even have to trick you into this.', 'Dark times. {name} is not helping.'],
  },
  steel: {
    chad: [
      'Nerves of steel. {name} is impressed.',
      'Iron discipline. {name} would know.',
      '{name} used Iron Defense! Nothing breaks this focus.',
    ],
    chud: ['Rusting away. {name} can hear it.', '{name} is made of steel. Your resolve is not.'],
  },
  fairy: {
    chad: [
      'Pure magic. {name} is sparkling.',
      '{name} is charmed by your focus.',
      "Dazzling work. {name} can't stop staring.",
    ],
    chud: [
      '{name} tried a little magic. It did not help.',
      'Not even pixie dust can save this session. {name} checked.',
    ],
  },
};

export const BY_POKEMON = {
  bulbasaur: {
    chad: ['Bulbasaur soaked up all that effort. Its bulb is glowing.'],
    chud: ['Bulbasaur needs sunlight. So do you. Get up.'],
  },
  charmander: {
    chad: ["Charmander's tail flame is burning bright. Good sign."],
    chud: ["Charmander's tail flame is flickering. That is on you."],
  },
  squirtle: {
    chad: ['Squirtle put its sunglasses on. Squad-level focus.'],
    chud: ["Squirtle went back in its shell. It can't watch."],
  },
  pikachu: {
    chad: ['Pika pika! (That means keep going.)', "Pikachu's cheeks are sparking. It is proud."],
    chud: ['Pika... (That is a sigh.)', 'Pikachu refuses to get in the ball until you get to work.'],
  },
  charizard: {
    chad: ['Charizard only listens to trainers this focused.', "Charizard's flame just turned blue. Keep going."],
    chud: ['Charizard is ignoring your orders. Fair enough.'],
  },
  meowth: {
    chad: ["That's right! Meowth smells a payday."],
    chud: ['Meowth says you are blasting off again. Not in the good way.'],
  },
  psyduck: {
    chad: ["Psyduck's headache is gone. Whatever you are doing, keep doing it."],
    chud: ['Psyduck has a headache just watching.'],
  },
  machamp: {
    chad: ['Machamp is giving you four thumbs up.'],
    chud: ['Machamp has four arms and still cannot lift you off the couch.'],
  },
  abra: {
    chad: ['Abra stayed awake for this. That almost never happens.'],
    chud: ['Abra teleported away rather than watch.'],
  },
  alakazam: {
    chad: ['Alakazam ran the numbers. This session is a good one.'],
    chud: ['Alakazam has an IQ of 5,000 and still cannot explain this.'],
  },
  slowpoke: {
    chad: ['Slowpoke will notice how well you did in about an hour.'],
    chud: ['Slowpoke noticed you slacking. That is how obvious it is.'],
  },
  gengar: {
    chad: ['Gengar is grinning. For once that is a good thing.'],
    chud: ['Gengar is grinning. That is never good.'],
  },
  chansey: {
    chad: ["Chansey says this is good for you. Nurse's orders."],
  },
  electrode: {
    chud: ['Electrode would rather use Self-Destruct than watch this.'],
  },
  magikarp: {
    chad: ['Keep splashing. Every Gyarados started here.'],
    chud: ['Magikarp used Splash. So did you. Nothing happened.'],
  },
  gyarados: {
    chad: ['Gyarados remembers being a Magikarp. Keep at it.'],
    chud: ['Gyarados is this angry for a reason. You are the reason.'],
  },
  ditto: {
    chad: ['Ditto is copying your work ethic.'],
    chud: ['Ditto transformed into your couch.'],
  },
  eevee: {
    chad: ['Eevee thinks you could become anything.'],
    chud: ['Eevee has eight futures. You are wasting your one.'],
  },
  porygon: {
    chad: ['Porygon compiled your progress. No errors found.'],
    chud: ['Porygon ran a diagnostic. The problem is you.'],
  },
  snorlax: {
    chad: ['Snorlax woke up just to watch this.'],
    chud: ['Even Snorlax gets up eventually.', 'Snorlax is impressed. That is not a compliment.'],
  },
  dragonite: {
    chad: ['Dragonite circled the globe while you focused. It is proud.'],
    chud: ['Dragonite delivers the mail faster than you start working.'],
  },
  mewtwo: {
    chad: ['Mewtwo senses real power here.'],
    chud: ['Mewtwo was made for greatness. It wonders what you were made for.'],
  },
  mew: {
    chad: ['Mew giggled. That is the rarest praise there is.'],
    chud: ['Mew is hiding under the truck again. So is your motivation.'],
  },
  metapod: {
    chad: ['Metapod used Harden. So did your resolve.'],
    chud: ['Metapod has moved more than you this hour.'],
  },
  jigglypuff: {
    chad: ['Jigglypuff sang and you stayed awake. Incredible.'],
    chud: ['Jigglypuff did not even have to sing.'],
  },
  farfetchd: {
    chad: ["Farfetch'd raised its leek in salute."],
  },
  togepi: {
    chad: ['Togepi waved its tiny hands. Metronome says: keep going.'],
  },
  umbreon: {
    chad: ["Umbreon's rings are glowing. Late-night focus."],
  },
  unown: {
    chad: ['The Unown spelled out G-O-O-D.'],
    chud: ['The Unown spelled out W-H-Y.'],
  },
  wobbuffet: {
    chad: ['Wobbuffet! (That is a yes.)'],
    chud: ['Wobbuffet... (That is a no.)'],
  },
  shuckle: {
    chud: ['Shuckle is the slowest Pokémon there is. It is lapping you.'],
  },
  tyranitar: {
    chad: ['Tyranitar moves mountains. You are not doing badly yourself.'],
  },
  celebi: {
    chad: ['Celebi came back from the future. It says this pays off.'],
    chud: ['Celebi came back from the future. It says you regret this.'],
  },
  slakoth: {
    chad: ['Slakoth moved for you. Do not waste it.'],
    chud: ['Slakoth is judging you. Slakoth.'],
  },
  slaking: {
    chad: ['Slaking is not loafing for once. Follow its lead.'],
    chud: ['Slaking loafs every other turn. What is your excuse?'],
  },
  gardevoir: {
    chad: ['Gardevoir would guard this focus with its life.'],
  },
  wooper: {
    chad: ['Wooper is smiling. Wooper is always smiling, but still.'],
  },
  rayquaza: {
    chad: ['Rayquaza came down from the sky to see this.'],
    chud: ['Rayquaza went back to the ozone layer. Call it when you start.'],
  },
  jirachi: {
    chad: ['Jirachi woke up to grant a wish. You are already making it happen.'],
    chud: ['Jirachi sleeps for a thousand years. Even it thinks this is a lot.'],
  },
  bidoof: {
    chad: ['Bidoof believes in you. Bidoof is never wrong.'],
    chud: ['Bidoof is building a dam. You are building nothing.'],
  },
  lucario: {
    chad: ['Lucario can feel your aura. It is strong.'],
    chud: ['Lucario read your aura. It is mostly snacks.'],
  },
  garchomp: {
    chad: ['Garchomp flies at jet speed. You are keeping up.'],
  },
  dialga: {
    chad: ['Dialga approves of how you are spending your time.'],
    chud: ['Dialga rules time. It hates watching you waste it.'],
  },
  regigigas: {
    chad: ['Regigigas got past Slow Start. So did you.'],
    chud: ['Regigigas has Slow Start. You have no start.'],
  },
  darkrai: {
    chud: ['Darkrai gives nightmares. This session is giving it one.'],
  },
  arceus: {
    chad: ['Arceus looked down and saw that it was good.'],
    chud: ['Arceus made a universe in less time.'],
  },
  greninja: {
    chad: ['Greninja moves in silence. So does real work.'],
  },
  mimikyu: {
    chad: ['Mimikyu just wants to be noticed. It noticed you.'],
    chud: ['Mimikyu wears a disguise. You are wearing pyjamas.'],
  },
  cosmog: {
    chad: ['Cosmog got out of the bag to see this.'],
  },
  zygarde: {
    chad: ['Zygarde is at 100%. So are you.'],
    chud: ['Zygarde is at 10%. That is still more than you.'],
  },
  zacian: {
    chad: ['Zacian drew its sword. Crowned work.'],
    chud: ['Zacian put its sword down. Nothing here worth fighting for.'],
  },
  fuecoco: {
    chad: ['Fuecoco is singing. Loudly. Proudly.'],
    chud: ['Fuecoco has one brain cell and it is worried about you.'],
  },
  tinkaton: {
    chad: ['Tinkaton is hammering away. So are you.'],
  },
  gholdengo: {
    chad: ['Gholdengo counted your points. Make it rain.'],
  },
};
