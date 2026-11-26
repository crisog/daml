// Writes the post's figures: pictures, and animated figures where the order
// of events is the point.
//
// Usage: node figures.mjs <output-directory> [stills-directory]
//   stills-directory  also write one frozen frame per case of each animated
//                     figure and a page that shows them all, for a look at each
//                     one without a clock
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BEAT,
  brokenLink,
  CANVAS_WIDTH,
  CASE_SECONDS,
  COLOR,
  captionLayers,
  caseEntry,
  DIMMED_OPACITY,
  flowLink,
  heading,
  idleLink,
  MARGIN,
  nodeBox,
  nodeNote,
  renderAnimated,
  renderPicture,
  renderStill,
  secondsAt,
  shownDuring,
  text,
  verdict,
} from "./figure-kit.mjs";

// Every case has settled by this second, and the next case has not started.
const STILL_BEAT_SECONDS = 5.2;
const NETWORK_HEIGHT = 680;
const VERDICT_Y = 590;

// The three nodes a two-party contract needs. They keep these places in every
// figure that shows them.
const SYNCHRONIZER = { x: 500, y: 190, width: 200, height: 84 };
const FIRST_PARTICIPANT = { x: 330, y: 380, width: 210, height: 96 };
const SECOND_PARTICIPANT = { x: 660, y: 380, width: 210, height: 96 };
const TO_SYNCHRONIZER = [
  [435, 380],
  [435, 327],
  [570, 327],
  [570, 274],
];
const FROM_SYNCHRONIZER = [
  [630, 274],
  [630, 327],
  [765, 327],
  [765, 380],
];

function loopOf(caseCount) {
  return caseCount * CASE_SECONDS;
}

// A part that the case `from` brings in at `beat`. It stays until the same
// beat of the case `to`, where another part replaces it.
function fromCaseToCase({ from, to, beat }) {
  return shownDuring([
    [secondsAt({ caseIndex: from, beat }), secondsAt({ caseIndex: to, beat })],
  ]);
}

function contractChip({ participant }) {
  const width = 140;
  const centre = participant.x + participant.width / 2;
  const foot = participant.y + participant.height;
  const y = foot + 18;
  return (
    `<path d="M${centre} ${foot}L${centre} ${y}" stroke="${COLOR.test}" stroke-width="2"/>` +
    `<rect x="${centre - width / 2}" y="${y}" width="${width}" height="40" fill="${COLOR.page}" stroke="${COLOR.test}" stroke-width="2"/>` +
    `<rect x="${centre - width / 2}" y="${y}" width="${width}" height="40" fill="${COLOR.test}" fill-opacity="0.16"/>` +
    text({
      x: centre,
      y: y + 26,
      content: "CONTRACT",
      size: 15,
      color: COLOR.test,
      weight: "bold",
      anchor: "middle",
      spacingEm: 0.06,
      fitWidth: width - 16,
    })
  );
}

function oneContractTwoNodes() {
  const caseCount = 3;
  const loopSeconds = loopOf(caseCount);
  // The steps add parts. The loop removes them when it returns to step 1.
  const loopEnd = caseEntry({ caseIndex: 0, caseCount });
  const sideNote = (y, content) =>
    text({
      x: 724,
      y,
      content,
      size: 16,
      color: COLOR.quiet,
      spacingEm: 0.06,
      fitWidth: CANVAS_WIDTH - 724 - 60,
    });
  return {
    name: "one-contract-two-nodes",
    height: NETWORK_HEIGHT,
    loopSeconds,
    posterSeconds: secondsAt({ caseIndex: 2, beat: STILL_BEAT_SECONDS }),
    title: "One contract on two participants",
    description:
      "Three steps. Step 1: Alice creates a contract for Bob on participant 1, the node that hosts her. " +
      "Step 2: participant 1 sends it through the synchronizer, which orders and delivers the message and cannot read it. " +
      "Step 3: participant 2, the node that hosts Bob, stores the same contract. Verdict: one contract, two nodes.",
    layers: [
      {
        markup:
          idleLink({ points: TO_SYNCHRONIZER }) +
          idleLink({ points: FROM_SYNCHRONIZER }),
      },
      {
        markup:
          flowLink({ points: TO_SYNCHRONIZER, color: COLOR.test }) +
          flowLink({ points: FROM_SYNCHRONIZER, color: COLOR.test }),
        states: shownDuring([
          [secondsAt({ caseIndex: 1, beat: BEAT.first }), loopEnd],
        ]),
      },
      {
        markup:
          nodeBox({ ...SYNCHRONIZER, title: "SYNCHRONIZER" }) +
          nodeBox({ ...FIRST_PARTICIPANT, title: "PARTICIPANT 1" }) +
          nodeNote({ box: FIRST_PARTICIPANT, content: "hosts Alice" }) +
          nodeBox({ ...SECOND_PARTICIPANT, title: "PARTICIPANT 2" }) +
          nodeNote({ box: SECOND_PARTICIPANT, content: "hosts Bob" }),
      },
      {
        markup: contractChip({ participant: FIRST_PARTICIPANT }),
        states: shownDuring([
          [secondsAt({ caseIndex: 0, beat: BEAT.first }), loopEnd],
        ]),
      },
      {
        markup:
          sideNote(224, "ORDERS AND DELIVERS") +
          sideNote(246, "CANNOT READ THE CONTRACT"),
        states: shownDuring([
          [secondsAt({ caseIndex: 1, beat: BEAT.second }), loopEnd],
        ]),
      },
      {
        markup: contractChip({ participant: SECOND_PARTICIPANT }),
        states: shownDuring([
          [secondsAt({ caseIndex: 2, beat: BEAT.first }), loopEnd],
        ]),
      },
      ...captionLayers({
        kind: "STEP",
        statements: [
          "Alice creates a contract for Bob on her own participant.",
          "The synchronizer orders the message and delivers it.",
          "Bob's participant stores the same contract. Bob can act on it.",
        ],
      }),
      {
        markup: verdict({
          y: VERDICT_Y,
          width: 420,
          content: "ONE CONTRACT, TWO NODES",
          tone: "plain",
        }),
        states: shownDuring([
          [secondsAt({ caseIndex: 2, beat: BEAT.verdict }), loopEnd],
        ]),
      },
    ],
  };
}

const PROCESS_WIDTH = 830;
const PROCESS_TOP = 150;
const PROCESS_HEIGHT = 356;

// The Canton process that both networks run: two synchronizers above three
// participants, in one JVM. `left` is the left edge of the process, and `names`
// gives each node the name it has in that network.
function cantonProcess({ left, label, names }) {
  const nodes = [
    {
      x: 168,
      y: 190,
      height: 84,
      title: "SYNCHRONIZER 1",
      name: names.firstSynchronizer,
    },
    {
      x: 453,
      y: 190,
      height: 84,
      title: "SYNCHRONIZER 2",
      name: names.secondSynchronizer,
    },
    {
      x: 25,
      y: 380,
      height: 96,
      title: "PARTICIPANT 1",
      name: names.firstParticipant,
    },
    {
      x: 310,
      y: 380,
      height: 96,
      title: "PARTICIPANT 2",
      name: names.secondParticipant,
    },
    {
      x: 595,
      y: 380,
      height: 96,
      title: "PARTICIPANT 3",
      name: names.thirdParticipant,
    },
  ];
  let markup =
    `<rect x="${left}" y="${PROCESS_TOP}" width="${PROCESS_WIDTH}" height="${PROCESS_HEIGHT}" stroke="${COLOR.faint}" stroke-width="2" stroke-dasharray="8 8"/>` +
    text({
      x: left + 20,
      y: PROCESS_TOP + 26,
      content: label,
      size: 16,
      color: COLOR.quiet,
      spacingEm: 0.08,
      fitWidth: 300,
    });
  for (const node of nodes) {
    const box = {
      x: left + node.x,
      y: node.y,
      width: 210,
      height: node.height,
    };
    markup +=
      nodeBox({ ...box, title: node.title }) +
      nodeNote({ box, content: node.name });
  }
  return markup;
}

function theSandbox() {
  return {
    name: "the-sandbox",
    height: NETWORK_HEIGHT,
    title: "What the sandbox runs",
    description:
      "The sandbox with --multi-sync is one Canton JVM. It runs three participants, named sandbox, pebblebox and sidebox, " +
      "and two synchronizers, named synchronizer-1 and synchronizer-2. Alice is on the first participant and Bob is on the second. " +
      "Readout: 1 process, 3 participants, 2 synchronizers.",
    markup:
      heading({
        kicker: "THE SANDBOX WITH THREE PARTICIPANTS",
        statement:
          "The sandbox is Canton only: participants and synchronizers.",
      }) +
      cantonProcess({
        left: (CANVAS_WIDTH - PROCESS_WIDTH) / 2,
        label: "CANTON · ONE JVM",
        names: {
          firstSynchronizer: "synchronizer-1",
          firstParticipant: "sandbox · Alice",
          secondParticipant: "pebblebox · Bob",
          thirdParticipant: "sidebox",
          secondSynchronizer: "synchronizer-2",
        },
      }) +
      verdict({
        y: VERDICT_Y,
        width: 640,
        content: "1 PROCESS · 3 PARTICIPANTS · 2 SYNCHRONIZERS",
        tone: "plain",
      }),
  };
}

function localnet() {
  const added = [
    { y: 150, title: "SPLICE APPS", note: "a second JVM" },
    { y: 275, title: "POSTGRES", note: "15 databases" },
    { y: 400, title: "8 MORE CONTAINERS", note: "7 web UIs and nginx" },
  ];
  const columnWidth = 230;
  let additions = text({
    x: MARGIN,
    y: 134,
    content: "LOCALNET ADDS",
    size: 16,
    color: COLOR.quiet,
    spacingEm: 0.08,
    fitWidth: columnWidth,
  });
  for (const { y, title, note } of added) {
    const box = { x: MARGIN, y, width: columnWidth, height: 106 };
    additions += nodeBox({ ...box, title }) + nodeNote({ box, content: note });
  }
  return {
    name: "localnet",
    height: NETWORK_HEIGHT,
    title: "What LocalNet runs",
    description:
      "LocalNet runs the same Canton JVM as the sandbox, with three participants named app-user, app-provider and sv, and the global synchronizer. " +
      "A second synchronizer is in the multi-sync profile. LocalNet adds a second JVM for the Splice apps, a Postgres server with 15 databases, " +
      "and eight more containers for seven web UIs and nginx. Readout: 11 containers, 2 JVMs, 1 Postgres server.",
    markup:
      heading({
        kicker: "LOCALNET",
        statement:
          "LocalNet is the same Canton, plus Splice and what Splice needs.",
      }) +
      additions +
      cantonProcess({
        left: CANVAS_WIDTH - MARGIN - PROCESS_WIDTH,
        label: "THE SAME CANTON · ONE JVM",
        names: {
          firstSynchronizer: "global",
          firstParticipant: "app-user",
          secondParticipant: "app-provider",
          thirdParticipant: "sv",
          secondSynchronizer: "multi-sync profile",
        },
      }) +
      verdict({
        y: VERDICT_Y,
        width: 640,
        content: "11 CONTAINERS · 2 JVMs · 1 POSTGRES SERVER",
        tone: "plain",
      }),
  };
}

function coldStarts() {
  // Medians of six cold starts on a boat.dev machine with 4 shared vCPUs.
  const rows = [
    { name: "SANDBOX · 1 PARTICIPANT", readySeconds: 31 },
    { name: "SANDBOX · 3 PARTICIPANTS", readySeconds: 38 },
    { name: "LOCALNET", readySeconds: 329 },
  ];
  const trackLeft = 340;
  const pxPerSecond = 2;
  const axisSeconds = 360;
  const tickSeconds = 60;
  const barHeight = 30;
  const rowStep = 46;
  const firstRowTop = 150;
  const axisTop = 140;
  const axisFoot = firstRowTop + (rows.length - 1) * rowStep + barHeight + 14;

  let markup = heading({
    kicker: "MEDIAN OF SIX COLD STARTS",
    statement:
      "Seconds from start to ready on a boat.dev machine with 4 vCPUs.",
  });
  for (
    let seconds = tickSeconds;
    seconds <= axisSeconds;
    seconds += tickSeconds
  ) {
    const x = trackLeft + seconds * pxPerSecond;
    markup +=
      `<path d="M${x} ${axisTop}L${x} ${axisFoot}" stroke="${COLOR.faint}" stroke-width="1" stroke-dasharray="2 6"/>` +
      text({
        x,
        y: axisFoot + 28,
        content: `${seconds} s`,
        size: 16,
        color: COLOR.quiet,
        anchor: "middle",
        fitWidth: 80,
      });
  }
  markup += `<path d="M${trackLeft} ${axisTop}L${trackLeft} ${axisFoot}" stroke="${COLOR.line}" stroke-width="2"/>`;
  for (const [index, row] of rows.entries()) {
    const y = firstRowTop + index * rowStep;
    const barWidth = row.readySeconds * pxPerSecond;
    markup +=
      text({
        x: MARGIN,
        y: y + 21,
        content: row.name,
        size: 16,
        weight: "bold",
        spacingEm: 0.04,
        fitWidth: 260,
      }) +
      `<rect x="${trackLeft}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${COLOR.quiet}" fill-opacity="0.7"/>` +
      text({
        x: trackLeft + barWidth + 12,
        y: y + 21,
        content: `${row.readySeconds} s`,
        size: 16,
        weight: "bold",
        spacingEm: 0.04,
        fitWidth: 80,
      });
  }
  return {
    name: "cold-starts",
    height: axisFoot + 60,
    title: "The cold start of each network on a boat.dev machine",
    description:
      "Horizontal bars of the seconds from start to ready, the median of six cold starts on a boat.dev machine with 4 shared vCPUs. " +
      "The sandbox with one participant: 31 seconds. The sandbox with three participants: 38 seconds. LocalNet: 329 seconds.",
    markup,
  };
}

function localnetStart() {
  // Medians of six cold starts on a boat.dev machine with 4 shared vCPUs, from
  // localnet-stages.py. The stages run one after the other.
  const stages = [
    { name: "POSTGRES STARTS", seconds: 11 },
    { name: "CANTON STARTS", seconds: 31 },
    { name: "THE SPLICE APPS START", seconds: 44 },
    { name: "SPLICE DECODES ITS PACKAGES", seconds: 81, longest: true },
    { name: "SPLICE CREATES THE SYNCHRONIZER", seconds: 27 },
    { name: "SPLICE UPLOADS THE PACKAGES", seconds: 31 },
    { name: "SPLICE CREATES THE NETWORK RULES", seconds: 25 },
    { name: "THE VALIDATORS JOIN", seconds: 52 },
    { name: "DOCKER WAITS FOR A HEALTH PROBE", seconds: 12 },
  ];
  const trackLeft = 470;
  const pxPerSecond = 2;
  const axisSeconds = 300;
  const tickSeconds = 60;
  const barHeight = 26;
  const rowStep = 38;
  const firstRowTop = 150;
  const axisTop = 140;
  const axisFoot = firstRowTop + (stages.length - 1) * rowStep + barHeight + 14;

  let markup = heading({
    kicker: "ONE LOCALNET START ON BOAT.DEV · MEDIAN OF SIX",
    statement:
      "A LocalNet start has nine stages. The longest decodes packages.",
  });
  for (
    let seconds = tickSeconds;
    seconds <= axisSeconds;
    seconds += tickSeconds
  ) {
    const x = trackLeft + seconds * pxPerSecond;
    markup +=
      `<path d="M${x} ${axisTop}L${x} ${axisFoot}" stroke="${COLOR.faint}" stroke-width="1" stroke-dasharray="2 6"/>` +
      text({
        x,
        y: axisFoot + 28,
        content: `${seconds} s`,
        size: 16,
        color: COLOR.quiet,
        anchor: "middle",
        fitWidth: 80,
      });
  }
  markup += `<path d="M${trackLeft} ${axisTop}L${trackLeft} ${axisFoot}" stroke="${COLOR.line}" stroke-width="2"/>`;
  let startSeconds = 0;
  for (const [index, stage] of stages.entries()) {
    const y = firstRowTop + index * rowStep;
    const barLeft = trackLeft + startSeconds * pxPerSecond;
    const barWidth = stage.seconds * pxPerSecond;
    const color = stage.longest ? COLOR.ink : COLOR.quiet;
    markup +=
      text({
        x: MARGIN,
        y: y + 19,
        content: stage.name,
        size: 16,
        weight: "bold",
        color,
        spacingEm: 0.04,
        fitWidth: 390,
      }) +
      `<rect x="${barLeft}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" fill-opacity="${stage.longest ? 1 : 0.7}"/>` +
      text({
        x: barLeft + barWidth + 12,
        y: y + 19,
        content: `${stage.seconds} s`,
        size: 16,
        weight: "bold",
        color,
        spacingEm: 0.04,
        fitWidth: 80,
      });
    startSeconds += stage.seconds;
  }
  return {
    name: "localnet-start",
    height: axisFoot + 60,
    title: "The stages of one LocalNet start",
    description:
      "A timeline of the nine stages of a LocalNet start on a boat.dev machine with 4 shared vCPUs, with the median of six starts for each stage. " +
      stages
        .map((stage) => `${stage.name.toLowerCase()}: ${stage.seconds} seconds`)
        .join(", ") +
      ". The stages sum to 314 seconds.",
    markup,
  };
}

function savedLedger() {
  // Medians of three starts of each kind on one boat.dev machine with 4 shared
  // vCPUs, from results/boat/boot/compare/ready.tsv (cold-r*, usable-r*).
  const rows = [
    { name: "COLD START · READY", seconds: 213, fromSavedLedger: false },
    {
      name: "COLD START · FIRST TRANSFER",
      seconds: 251,
      fromSavedLedger: false,
    },
    { name: "SAVED LEDGER · READY", seconds: 93, fromSavedLedger: true },
    {
      name: "SAVED LEDGER · FIRST TRANSFER",
      seconds: 104,
      fromSavedLedger: true,
    },
  ];
  const trackLeft = 400;
  const pxPerSecond = 2.6;
  const axisSeconds = 240;
  const tickSeconds = 60;
  const barHeight = 30;
  const rowStep = 46;
  const pairGap = 18;
  const firstRowTop = 150;
  const axisTop = 140;
  const axisFoot =
    firstRowTop + (rows.length - 1) * rowStep + pairGap + barHeight + 14;

  let markup = heading({
    kicker: "MEDIAN OF THREE STARTS ON ONE BOAT.DEV MACHINE",
    statement:
      "Seconds from start to ready, and to the first transfer that passes.",
  });
  for (
    let seconds = tickSeconds;
    seconds <= axisSeconds;
    seconds += tickSeconds
  ) {
    const x = trackLeft + seconds * pxPerSecond;
    markup +=
      `<path d="M${x} ${axisTop}L${x} ${axisFoot}" stroke="${COLOR.faint}" stroke-width="1" stroke-dasharray="2 6"/>` +
      text({
        x,
        y: axisFoot + 28,
        content: `${seconds} s`,
        size: 16,
        color: COLOR.quiet,
        anchor: "middle",
        fitWidth: 80,
      });
  }
  markup += `<path d="M${trackLeft} ${axisTop}L${trackLeft} ${axisFoot}" stroke="${COLOR.line}" stroke-width="2"/>`;
  for (const [index, row] of rows.entries()) {
    let y = firstRowTop + index * rowStep;
    let color = COLOR.quiet;
    let fillOpacity = 0.7;
    if (row.fromSavedLedger) {
      y += pairGap;
      color = COLOR.ink;
      fillOpacity = 1;
    }
    const barWidth = row.seconds * pxPerSecond;
    markup +=
      text({
        x: MARGIN,
        y: y + 21,
        content: row.name,
        size: 16,
        weight: "bold",
        color,
        spacingEm: 0.04,
        fitWidth: 320,
      }) +
      `<rect x="${trackLeft}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" fill-opacity="${fillOpacity}"/>` +
      text({
        x: trackLeft + barWidth + 12,
        y: y + 21,
        content: `${row.seconds} s`,
        size: 16,
        weight: "bold",
        color,
        spacingEm: 0.04,
        fitWidth: 80,
      });
  }
  return {
    name: "saved-ledger",
    height: axisFoot + 60,
    title: "A cold start of LocalNet and a start from a saved ledger",
    description:
      "Horizontal bars of the seconds from the start of LocalNet, the median of three starts of each kind on one boat.dev machine with 4 shared vCPUs. " +
      "A cold start: ready after 213 seconds, and the first transfer passed after 251 seconds. " +
      "A start from a saved ledger: ready after 93 seconds, and the first transfer passed after 104 seconds.",
    markup,
  };
}

function coinTest() {
  // Medians of three runs on one boat.dev machine with 4 shared vCPUs
  // (results/boat/slim-ab and results/boat/coin-sandbox/same-machine).
  const rows = [
    { name: "NO NETWORK · SPLICE'S OWN TESTS", seconds: 30 },
    { name: "SANDBOX · SPLICE'S PACKAGES, NO APP", seconds: 45, noApp: true },
    { name: "LOCALNET · TWO VALIDATORS, NO WEB UI", seconds: 137 },
    { name: "LOCALNET AS SHIPPED", seconds: 161 },
  ];
  const trackLeft = 470;
  const pxPerSecond = 3.5;
  const axisSeconds = 180;
  const tickSeconds = 30;
  const barHeight = 30;
  const rowStep = 46;
  const firstRowTop = 150;
  const axisTop = 140;
  const axisFoot = firstRowTop + (rows.length - 1) * rowStep + barHeight + 14;

  let markup = heading({
    kicker: "ONE BOAT.DEV MACHINE · MEDIAN OF THREE RUNS",
    statement: "Seconds from nothing to a Canton Coin test that passed.",
  });
  for (
    let seconds = tickSeconds;
    seconds <= axisSeconds;
    seconds += tickSeconds
  ) {
    const x = trackLeft + seconds * pxPerSecond;
    markup +=
      `<path d="M${x} ${axisTop}L${x} ${axisFoot}" stroke="${COLOR.faint}" stroke-width="1" stroke-dasharray="2 6"/>` +
      text({
        x,
        y: axisFoot + 28,
        content: `${seconds} s`,
        size: 16,
        color: COLOR.quiet,
        anchor: "middle",
        fitWidth: 80,
      });
  }
  markup += `<path d="M${trackLeft} ${axisTop}L${trackLeft} ${axisFoot}" stroke="${COLOR.line}" stroke-width="2"/>`;
  for (const [index, row] of rows.entries()) {
    const y = firstRowTop + index * rowStep;
    const barWidth = row.seconds * pxPerSecond;
    const color = row.noApp ? COLOR.ink : COLOR.quiet;
    markup +=
      text({
        x: MARGIN,
        y: y + 21,
        content: row.name,
        size: 16,
        weight: "bold",
        color,
        spacingEm: 0.04,
        fitWidth: 390,
      }) +
      `<rect x="${trackLeft}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" fill-opacity="${row.noApp ? 1 : 0.7}"/>` +
      text({
        x: trackLeft + barWidth + 12,
        y: y + 21,
        content: `${row.seconds} s`,
        size: 16,
        weight: "bold",
        color,
        spacingEm: 0.04,
        fitWidth: 80,
      });
  }
  return {
    name: "coin-test",
    height: axisFoot + 60,
    title: "A Canton Coin test on four networks",
    description:
      "Horizontal bars of the seconds from nothing to a Canton Coin test that passed, the median of three runs on one boat.dev machine with 4 shared vCPUs. " +
      "No network, Splice's own transfer tests: 30 seconds. " +
      "The sandbox with Splice's packages and no Splice app, five transfers between two participants: 45 seconds. " +
      "LocalNet with two validators and no web UI, five transfers: 137 seconds. " +
      "LocalNet as shipped, five transfers: 161 seconds.",
    markup,
  };
}

function memoryFollowsTheLimit() {
  const caseCount = 2;
  const withLimits = 0;
  const withoutLimits = 1;
  const backToLimits = caseEntry({ caseIndex: withLimits, caseCount });
  const scaleLeft = 220;
  const pxPerGib = 76;
  const scaleGib = 12;
  const barTop = 250;
  const barHeight = 90;
  const barFoot = barTop + barHeight;
  const xAt = (gib) => scaleLeft + gib * pxPerGib;

  let axis = `<rect x="${scaleLeft}" y="${barTop}" width="${scaleGib * pxPerGib}" height="${barHeight}" stroke="${COLOR.faint}" stroke-width="2" stroke-dasharray="8 8"/>`;
  for (let gib = 0; gib <= scaleGib; gib += 2) {
    axis += `<path d="M${xAt(gib)} ${barFoot}L${xAt(gib)} ${barFoot + 10}" stroke="${COLOR.line}" stroke-width="2"/>`;
    axis += text({
      x: xAt(gib),
      y: barFoot + 32,
      content: `${gib} GiB`,
      size: 16,
      color: COLOR.quiet,
      anchor: "middle",
      fitWidth: 2 * pxPerGib,
    });
  }
  const rowName = (y, content) =>
    text({
      x: 60,
      y,
      content,
      size: 18,
      weight: "bold",
      spacingEm: 0.04,
      fitWidth: 150,
    });
  const heldBar = (gib) =>
    `<rect x="${scaleLeft}" y="${barTop}" width="${gib * pxPerGib}" height="${barHeight}" fill="${COLOR.page}"/>` +
    `<rect x="${scaleLeft}" y="${barTop}" width="${gib * pxPerGib}" height="${barHeight}" fill="${COLOR.line}" fill-opacity="0.5" stroke="${COLOR.ink}" stroke-width="2"/>`;
  const heldLabel = (content) =>
    text({
      x: scaleLeft,
      y: barTop - 16,
      content,
      size: 16,
      weight: "bold",
      spacingEm: 0.04,
      fitWidth: 220,
    });
  const liveData = ({ gib, content }) =>
    `<rect x="${scaleLeft + 6}" y="${barTop + 6}" width="${gib * pxPerGib - 6}" height="${barHeight - 12}" fill="${COLOR.page}"/>` +
    `<rect x="${scaleLeft + 6}" y="${barTop + 6}" width="${gib * pxPerGib - 6}" height="${barHeight - 12}" fill="${COLOR.test}" fill-opacity="0.3" stroke="${COLOR.test}" stroke-width="2"/>` +
    `<path d="M${scaleLeft + 24} ${barFoot}L${scaleLeft + 24} ${barFoot + 52}" stroke="${COLOR.test}" stroke-width="2"/>` +
    text({
      x: scaleLeft + 6,
      y: barFoot + 72,
      content,
      size: 16,
      color: COLOR.test,
      weight: "bold",
      spacingEm: 0.06,
      fitWidth: 520,
    });
  const limitGib = 4;
  const swapLiveAt = secondsAt({ caseIndex: withoutLimits, beat: BEAT.third });
  const growAt = secondsAt({ caseIndex: withoutLimits, beat: BEAT.second });
  return {
    name: "memory-follows-the-limit",
    height: 600,
    loopSeconds: loopOf(caseCount),
    posterSeconds: secondsAt({
      caseIndex: withoutLimits,
      beat: STILL_BEAT_SECONDS,
    }),
    title: "LocalNet's Canton container holds what its limit allows",
    description:
      "Two cases on one memory scale from 0 to 12 GiB. Case 1: with the limits LocalNet ships, a 4 GiB container limit, " +
      "the idle Canton container holds 2.6 GiB, and 0.5 GiB of that is live data after a forced full collection. " +
      "Case 2: with the limits removed on a 125 GiB machine, the same idle container holds 10.5 GiB, far past the old limit, and its live data is 0.4 GiB. " +
      "Verdict: memory held follows the limit, not the data.",
    layers: [
      { markup: axis + rowName(290, "CANTON") + rowName(314, "CONTAINER") },
      // The larger bar covers this one, so this one needs no states.
      { markup: heldBar(2.6) },
      {
        markup: heldLabel("HOLDS 2.6 GiB"),
        states: shownDuring([[backToLimits, growAt]]),
      },
      {
        markup: heldBar(10.45) + heldLabel("HOLDS 10.5 GiB"),
        states: shownDuring([[growAt, backToLimits]]),
      },
      {
        markup:
          `<path d="M${xAt(limitGib)} ${barTop - 26}L${xAt(limitGib)} ${barFoot + 12}" stroke="${COLOR.limit}" stroke-width="2" stroke-dasharray="8 6"/>` +
          text({
            x: xAt(limitGib) + 10,
            y: barTop - 16,
            content: "LIMIT 4 GiB",
            size: 16,
            color: COLOR.limit,
            weight: "bold",
            spacingEm: 0.04,
            fitWidth: 160,
          }),
        states: [
          {
            at: secondsAt({ caseIndex: withoutLimits, beat: BEAT.first }),
            opacity: DIMMED_OPACITY,
          },
          { at: backToLimits, opacity: 1 },
        ],
      },
      {
        markup: liveData({
          gib: 0.52,
          content: "0.5 GiB IS LIVE DATA AFTER A FULL COLLECTION",
        }),
        states: shownDuring([[backToLimits, swapLiveAt]]),
      },
      {
        markup: liveData({
          gib: 0.43,
          content: "0.4 GiB IS LIVE DATA AFTER A FULL COLLECTION",
        }),
        states: shownDuring([[swapLiveAt, backToLimits]]),
      },
      ...captionLayers({
        kind: "CASE",
        statements: [
          "With LocalNet's limits, the idle Canton container holds 2.6 GiB.",
          "Remove the limits and the same idle container holds 10.5 GiB.",
        ],
      }),
      {
        markup: verdict({
          y: 510,
          width: 700,
          content: "MEMORY HELD FOLLOWS THE LIMIT, NOT THE DATA",
          tone: "plain",
        }),
        states: shownDuring([
          [
            secondsAt({ caseIndex: withoutLimits, beat: BEAT.verdict }),
            backToLimits,
          ],
        ]),
      },
    ],
  };
}

function theCollectorTrap() {
  const caseCount = 3;
  const bigContainer = 0;
  const smallContainer = 1;
  const forcedCollector = 2;
  const entry = (caseIndex) => caseEntry({ caseIndex, caseCount });
  // G1 runs in case 3 and in case 1, so its parts stay through the end of the
  // loop. The Serial parts replace them in case 2.
  const withG1 = (beat) =>
    fromCaseToCase({ from: forcedCollector, to: smallContainer, beat });
  const withSerial = (beat) =>
    fromCaseToCase({ from: smallContainer, to: forcedCollector, beat });
  const heapLeft = 60;
  const heapTop = 276;
  const heapHeight = 110;
  const pxPerMib = 3;
  const heapMib = 256;
  const youngMib = heapMib / 3;
  const liveMib = 217;
  const oldLeft = heapLeft + youngMib * pxPerMib;
  const heapRight = heapLeft + heapMib * pxPerMib;
  const blockTop = heapTop + 30;
  const blockHeight = heapHeight - 36;
  const guard = { x: 868, y: heapTop, width: 272, height: heapHeight };
  const command = { x: 60, y: 440, width: 250, height: 60 };
  const commandPath = [
    [command.x + command.width, command.y + command.height / 2],
    [guard.x + guard.width / 2, command.y + command.height / 2],
    [guard.x + guard.width / 2, guard.y + guard.height],
  ];
  const chip = ({ x, width, name }) =>
    `<rect x="${x}" y="150" width="${width}" height="62" fill="${COLOR.page}" stroke="${COLOR.line}" stroke-width="2"/>` +
    text({
      x: x + 16,
      y: 172,
      content: name,
      size: 14,
      color: COLOR.quiet,
      spacingEm: 0.08,
      fitWidth: width - 32,
    });
  const chipValue = ({ x, width, content }) =>
    text({
      x: x + 16,
      y: 198,
      content,
      size: 18,
      weight: "bold",
      fitWidth: width - 32,
    });
  const block = ({ x, width, color }) =>
    `<rect x="${x}" y="${blockTop}" width="${width}" height="${blockHeight}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2"/>`;
  const blockLabel = ({ x, content, fitWidth }) =>
    text({ x, y: blockTop + 45, content, size: 17, weight: "bold", fitWidth });
  const heapNote = ({ x, y, content, fitWidth }) =>
    text({
      x,
      y,
      content,
      size: 15,
      color: COLOR.quiet,
      spacingEm: 0.04,
      fitWidth,
    });
  const guardLine = (y, content, color) =>
    text({
      x: guard.x + 16,
      y,
      content,
      size: 15,
      color,
      fitWidth: guard.width - 32,
    });
  const container = { x: 60, width: 250 };
  const collector = { x: 370, width: 320 };
  return {
    name: "the-collector-trap",
    height: 660,
    loopSeconds: loopOf(caseCount),
    posterSeconds: secondsAt({
      caseIndex: smallContainer,
      beat: STILL_BEAT_SECONDS,
    }),
    title:
      "A small container changes the collector, and the collector changes the heap",
    description:
      "Three cases with one 256 MiB heap and 217 MiB of live data. Case 1: in a 2 GiB container the JVM picks the G1 collector. " +
      "The old generation can grow to the whole heap, the live data fits, the heap guard of Canton passes, and the command of Alice is accepted. " +
      "Case 2: in a 1.5 GiB container the JVM picks the Serial collector, which gives the old generation a fixed 171 MiB. " +
      "The old generation is full after every collection, the guard trips, and the command is rejected with HTTP 409 HEAP_MEMORY_OVER_LIMIT. " +
      "Case 3: the same 1.5 GiB container with -XX:+UseG1GC. The fixed split is gone and the command is accepted.",
    layers: [
      {
        markup:
          idleLink({
            points: [
              [container.x + container.width, 181],
              [collector.x, 181],
            ],
          }) +
          idleLink({
            points: [
              [heapRight, heapTop + heapHeight / 2],
              [guard.x, heapTop + heapHeight / 2],
            ],
          }) +
          idleLink({ points: commandPath }),
      },
      {
        markup: flowLink({ points: commandPath, color: COLOR.test }),
        states: withG1(BEAT.third),
      },
      {
        markup: brokenLink({
          points: commandPath,
          cross: [620, command.y + command.height / 2],
        }),
        states: withSerial(BEAT.third),
      },
      {
        markup:
          chip({ ...container, name: "CONTAINER" }) +
          chip({ ...collector, name: "COLLECTOR" }) +
          text({
            x: heapLeft,
            y: heapTop - 14,
            content: "HEAP · 256 MiB",
            size: 16,
            color: COLOR.quiet,
            spacingEm: 0.08,
            fitWidth: 200,
          }) +
          `<rect x="${heapLeft}" y="${heapTop}" width="${heapMib * pxPerMib}" height="${heapHeight}" fill="${COLOR.page}" stroke="${COLOR.ink}" stroke-width="2"/>` +
          `<rect x="${guard.x}" y="${guard.y}" width="${guard.width}" height="${guard.height}" fill="${COLOR.page}" stroke="${COLOR.ink}" stroke-width="2"/>` +
          text({
            x: guard.x + 16,
            y: guard.y + 30,
            content: "CANTON'S HEAP GUARD",
            size: 15,
            weight: "bold",
            spacingEm: 0.04,
            fitWidth: guard.width - 32,
          }) +
          `<rect x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" fill="${COLOR.page}" stroke="${COLOR.ink}" stroke-width="2"/>` +
          text({
            x: command.x + command.width / 2,
            y: command.y + 37,
            content: "ALICE'S COMMAND",
            size: 16,
            weight: "bold",
            anchor: "middle",
            spacingEm: 0.04,
            fitWidth: command.width - 32,
          }),
      },
      {
        markup: chipValue({ ...container, content: "2 GiB · 2 CPUs" }),
        states: shownDuring([[entry(bigContainer), entry(smallContainer)]]),
      },
      {
        markup: chipValue({ ...container, content: "1.5 GiB · 2 CPUs" }),
        states: shownDuring([[entry(smallContainer), entry(bigContainer)]]),
      },
      {
        markup: chipValue({ ...collector, content: "G1 · THE JVM'S CHOICE" }),
        states: shownDuring([[entry(bigContainer), entry(smallContainer)]]),
      },
      {
        markup: chipValue({
          ...collector,
          content: "SERIAL · THE JVM'S CHOICE",
        }),
        states: shownDuring([[entry(smallContainer), entry(forcedCollector)]]),
      },
      {
        markup: chipValue({ ...collector, content: "G1 · -XX:+UseG1GC" }),
        states: shownDuring([[entry(forcedCollector), entry(bigContainer)]]),
      },
      {
        markup: heapNote({
          x: heapLeft + 12,
          y: heapTop + 20,
          content: "ONE SPACE: THE OLD GENERATION CAN GROW TO 256 MiB",
          fitWidth: 700,
        }),
        states: withG1(BEAT.first),
      },
      {
        markup:
          `<path d="M${oldLeft} ${heapTop}L${oldLeft} ${heapTop + heapHeight}" stroke="${COLOR.ink}" stroke-width="2"/>` +
          heapNote({
            x: heapLeft + 12,
            y: heapTop + 20,
            content: "YOUNG · 85 MiB",
            fitWidth: 230,
          }) +
          heapNote({
            x: oldLeft + 12,
            y: heapTop + 20,
            content: "OLD · FIXED AT 171 MiB",
            fitWidth: 480,
          }),
        states: withSerial(BEAT.first),
      },
      {
        markup:
          block({
            x: heapLeft + 6,
            width: liveMib * pxPerMib - 6,
            color: COLOR.test,
          }) +
          blockLabel({
            x: heapLeft + 22,
            content: "LIVE DATA · 217 MiB",
            fitWidth: 600,
          }),
        states: withG1(BEAT.second),
      },
      {
        markup:
          block({
            x: oldLeft + 6,
            width: heapRight - oldLeft - 12,
            color: COLOR.reject,
          }) +
          blockLabel({
            x: oldLeft + 22,
            content: "FULL · 171 OF 171 MiB",
            fitWidth: 460,
          }) +
          block({
            x: oldLeft - 6 - (liveMib - 171) * pxPerMib,
            width: (liveMib - 171) * pxPerMib,
            color: COLOR.reject,
          }) +
          blockLabel({
            x: oldLeft + 6 - (liveMib - 171) * pxPerMib,
            content: "46 MiB OVER",
            fitWidth: (liveMib - 171) * pxPerMib - 12,
          }),
        states: withSerial(BEAT.second),
      },
      {
        markup:
          guardLine(guard.y + 58, "old generation holds", COLOR.quiet) +
          guardLine(guard.y + 80, "217 of 256 MiB: passes", COLOR.test),
        states: withG1(BEAT.third),
      },
      {
        markup:
          guardLine(guard.y + 58, "old generation is full", COLOR.quiet) +
          guardLine(guard.y + 80, "after every collection", COLOR.reject),
        states: withSerial(BEAT.third),
      },
      ...captionLayers({
        kind: "CASE",
        statements: [
          "In a 2 GiB container the JVM picks the G1 collector.",
          "Below 1,792 MiB the JVM selects Serial, with a fixed old generation.",
          "Same small container with -XX:+UseG1GC. The fixed split is gone.",
        ],
      }),
      {
        markup: verdict({
          y: 570,
          width: 420,
          content: "COMMAND ACCEPTED",
          tone: "good",
        }),
        states: withG1(BEAT.verdict),
      },
      {
        markup: verdict({
          y: 570,
          width: 560,
          content: "HTTP 409 · HEAP_MEMORY_OVER_LIMIT",
          tone: "bad",
        }),
        states: withSerial(BEAT.verdict),
      },
    ],
  };
}

function writeStills({ figures, directory }) {
  mkdirSync(directory, { recursive: true });
  let page =
    '<!doctype html><meta charset="utf-8"><title>Figure stills</title>' +
    '<body style="margin:16px;background:#fff;font:14px sans-serif">';
  for (const figure of figures) {
    const caseCount = figure.loopSeconds / CASE_SECONDS;
    page += `<h3>${figure.name}</h3><div style="display:flex;flex-wrap:wrap;gap:8px">`;
    for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
      const file = `${figure.name}-case-${caseIndex + 1}.svg`;
      const second = secondsAt({ caseIndex, beat: STILL_BEAT_SECONDS });
      writeFileSync(join(directory, file), renderStill({ figure, second }));
      page += `<img src="${file}" width="620" alt="${figure.name}, case ${caseIndex + 1}">`;
    }
    page += "</div>";
  }
  writeFileSync(join(directory, "index.html"), `${page}</body>`);
}

function main() {
  const [outputDirectory, stillsDirectory] = process.argv.slice(2);
  assert.ok(
    outputDirectory,
    "usage: node figures.mjs <output-directory> [stills-directory]",
  );
  const pictures = [
    theSandbox(),
    localnet(),
    coldStarts(),
    localnetStart(),
    savedLedger(),
    coinTest(),
  ];
  const animated = [
    oneContractTwoNodes(),
    memoryFollowsTheLimit(),
    theCollectorTrap(),
  ];
  mkdirSync(outputDirectory, { recursive: true });
  for (const figure of pictures) {
    writeFileSync(
      join(outputDirectory, `${figure.name}.svg`),
      renderPicture(figure),
    );
  }
  for (const figure of animated) {
    writeFileSync(
      join(outputDirectory, `${figure.name}.svg`),
      renderAnimated(figure),
    );
  }
  if (stillsDirectory) {
    writeStills({ figures: animated, directory: stillsDirectory });
  }
  console.log(
    `wrote ${pictures.length + animated.length} figures to ${outputDirectory}`,
  );
}

main();
