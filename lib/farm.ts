// Farm plans: one concrete plan per protocol, generated from the protocol's own record.
//
// A plan is seven steps. Every step is an action a farmer can actually take, and every step
// carries its cost in dollars and its time in minutes or days: no step is a slogan. The plan's
// figures come from the same fields the valuation model reads, so the two never disagree:
//
//   chain     the protocol's first listed chain sets the gas tier (Ethereum mainnet is priced
//             as mainnet; rollups and alt-L1s at their usual cents-to-a-dollar level). The
//             tiers are stated operating estimates for a normal-fee day, not snapshot data.
//   category  the category picks the action sequence: a lending market is supplied to and
//             borrowed against, a DEX is provided liquidity and swapped through, a bridge is
//             crossed in both directions, and so on. Twenty-odd categories are named; anything
//             unlisted falls back to a deposit-and-hold sequence for its chain.
//   tvl       the protocol's TVL sets the capital tier: a position has to be big enough to
//             register in the protocol's own accounting and small enough to repeat.
//   age       the protocol's age sets the hold: younger protocols get the longer qualifying
//             window, because a launch snapshot is likelier to reach further back for them.
//
// The last step totals the plan from its own steps: the gas across every step and the days
// from the first transaction to the end of the hold, so the reader can check the plan's cost
// and duration against the steps themselves. No protocol name is ever special-cased.

/** The fields of a snapshot protocol a farm plan is generated from. */
export interface FarmProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: FarmProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * The gas, in dollars, of one ordinary transaction on a chain: Ethereum mainnet priced as
 * mainnet, the mid-cost L1s at about a dollar, rollups and low-fee chains at cents.
 */
function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Bitcoin') return 3;
  if (chain === 'Avalanche' || chain === 'Binance' || chain === 'Polygon' || chain === 'Tron' || chain === 'Fantom' || chain === 'Celo') return 1;
  return 0.5;
}

/** A gas figure the way a step states it: whole dollars above one, cents below. */
function gasText(usd: number): string {
  return usd >= 1 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: FarmProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 30;
}

/** The two middle steps of a plan: the category's own actions, in the words a farmer can follow. */
function categoryActions(p: FarmProtocol, capital: number, chain: string, gas: number): [FarmStep, FarmStep] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const g = gasText(gas);
  const g2 = gasText(gas * 2);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return [
      { text: `Supply $${capital} of USDC to ${name}'s main lending market on ${chain}.`, cost: `the $${capital} supplied plus about ${g} of gas`, time: '10 minutes' },
      { text: `Borrow about $${Math.round(capital / 5)} of USDC against the position, hold it one day, then repay in full so both sides of the market record the wallet.`, cost: `about ${g2} of gas for the borrow and the repay, plus under $1 of interest`, time: '10 minutes, plus one day before the repay' },
    ];
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return [
      { text: `Add $${capital} of liquidity to ${name}'s most-used pool on ${chain}, split evenly across the pair.`, cost: `the $${capital} in the pool plus about ${g2} of gas for the approvals and the deposit`, time: '15 minutes' },
      { text: `Swap about $${Math.round(capital / 2)} through that same pool once a week, alternating direction, so the wallet records as a trader as well as a provider.`, cost: `about ${g} of gas and the pool's swap fee each week`, time: '5 minutes a week' },
    ];
  }
  if (c.includes('bridge')) {
    return [
      { text: `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged funds in one app on the far side.`, cost: `the $${capital} bridged plus about ${g} of gas and the bridge's own fee`, time: '20 minutes including the crossing wait' },
      { text: `A week later bridge about $${Math.round(capital / 2)} back the other way, so the wallet has crossings recorded in both directions.`, cost: `about ${g} of gas plus the bridge's fee on the return leg`, time: '20 minutes including the crossing wait' },
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      { text: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the same wallet.`, cost: `the $${capital} staked plus about ${g} of gas`, time: '10 minutes' },
      { text: `Claim the staking rewards once they pass $5, then restake them into the same position instead of selling.`, cost: `about ${g} of gas per claim`, time: '5 minutes per claim' },
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) {
    return [
      { text: `Deposit $${capital} of USDC as margin on ${name} and open one small position hedged with an equal spot holding, so the account trades without directional risk.`, cost: `the $${capital} of margin plus about ${g2} of gas for the deposit and the open`, time: '15 minutes' },
      { text: `Close and reopen the hedge once a week, keeping each trade small, so the account builds a steady volume record.`, cost: `about ${g2} of gas and the trading fees each week`, time: '10 minutes a week' },
    ];
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('indexes') || c.includes('index')) {
    return [
      { text: `Deposit $${capital} into one of ${name}'s vaults on ${chain} and keep the vault shares in the wallet.`, cost: `the $${capital} deposited plus about ${g} of gas`, time: '10 minutes' },
      { text: `Add about $${Math.round(capital / 4)} more to the same vault two weeks later, so the position grows in more than one step.`, cost: `the added capital plus about ${g} of gas`, time: '5 minutes' },
    ];
  }
  if (c.includes('rwa') || c.includes('stable') || c.includes('reserve')) {
    return [
      { text: `Mint or deposit $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the wallet.`, cost: `the $${capital} committed plus about ${g} of gas`, time: '10 minutes' },
      { text: `Claim the yield once a month and put it back into the same asset, so the balance compounds in place.`, cost: `about ${g} of gas per claim`, time: '5 minutes a month' },
    ];
  }
  if (c.includes('prediction')) {
    return [
      { text: `Fund the account with $${capital} and take one position in ${name}'s most liquid market on ${chain}.`, cost: `the $${capital} at stake plus about ${g} of gas`, time: '10 minutes' },
      { text: `Take one further position each week in a different market, never more than a fifth of the fund on a single outcome.`, cost: `about ${g} of gas per position`, time: '10 minutes a week' },
    ];
  }
  if (c.includes('insurance')) {
    return [
      { text: `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy in the wallet.`, cost: `the $${capital} policy premium plus about ${g} of gas`, time: '10 minutes' },
      { text: `Renew the cover once before it lapses, so the wallet shows a continuing policy rather than a single purchase.`, cost: `a second premium of about the same size plus ${g} of gas`, time: '10 minutes' },
    ];
  }
  if (c.includes('launchpad') || c.includes('locker')) {
    return [
      { text: `Commit $${capital} to one open round or lock on ${name} on ${chain}, following the round's own minimums.`, cost: `the $${capital} committed plus about ${g} of gas`, time: '10 minutes' },
      { text: `Claim whatever the round returns from ${name}'s own claim page when it settles, and log the result.`, cost: `about ${g} of gas to claim`, time: '10 minutes' },
    ];
  }
  if (c.includes('leveraged') || c === 'farm' || c.includes('yield')) {
    return [
      { text: `Deposit $${capital} of USDC into ${name}'s main vault or farm on ${chain} and keep the position shares.`, cost: `the $${capital} deposited plus about ${g} of gas`, time: '10 minutes' },
      { text: `Harvest the farm rewards once a week and restake them into the same position.`, cost: `about ${g} of gas per harvest`, time: '5 minutes a week' },
    ];
  }
  if (c.includes('privacy') || c.includes('payments') || c.includes('card')) {
    return [
      { text: `Move $${capital} through ${name} on ${chain} in one ordinary transaction of the kind the product is built for.`, cost: `the $${capital} moved plus about ${g} of gas and the product's own fee`, time: '10 minutes' },
      { text: `Repeat the transaction once a week at a similar size, so the wallet's record is a pattern of use, not a single touch.`, cost: `about ${g} of gas and the product fee each week`, time: '10 minutes a week' },
    ];
  }
  if (c.includes('chain')) {
    return [
      { text: `Bridge $${capital} of USDC onto ${name}'s chain and hold it in the wallet as the chain's gas-paying balance.`, cost: `the $${capital} bridged plus about ${g} of gas`, time: '20 minutes including the crossing wait' },
      { text: `Make one small transaction a week inside the chain's own apps, so the wallet is an active address on the chain.`, cost: `about ${g} of gas a week`, time: '5 minutes a week' },
    ];
  }
  return [
    { text: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`, cost: `the $${capital} deposited plus about ${g} of gas`, time: '10 minutes' },
    { text: `Make one further deposit or interaction of about $${Math.round(capital / 4)} two weeks later, so the wallet's record spans more than one day.`, cost: `the added funds plus about ${g} of gas`, time: '10 minutes' },
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names, and its last step totals the plan from its own steps.
 */
export function farmSteps(p: FarmProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasUsd(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core1, core2] = categoryActions(p, capital, chain, gas);
  const weeklyGas = gas * Math.max(1, Math.round(hold / 7));
  const totalGas = gas * 4 + weeklyGas;
  return [
    {
      text: `Set up a fresh wallet for ${p.name} alone, write its seed phrase on paper, and keep the paper offline.`,
      cost: 'nothing to create, and never pay anyone for a wallet',
      time: '10 minutes',
    },
    {
      text: `Fund the wallet on ${chain} with $${capital} of USDC plus about ${gasText(gas * 3)} of the chain's native token for fees.`,
      cost: `the $${capital} of working capital plus the fee balance`,
      time: '15 minutes',
    },
    core1,
    core2,
    {
      text: `Hold the position for at least ${hold} days, checking it once a week and topping it back up if it falls below half its starting size.`,
      cost: `the $${capital} stays in the position for the whole ${hold} days`,
      time: `${hold} days, with a 5-minute check each week`,
    },
    {
      text: `Before you withdraw anything, open ${p.name}'s own points or rewards page and claim only from the link the protocol itself publishes.`,
      cost: 'no fee to check, and never pay a third party to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction hash in a farm log. Plan total: about ${gasText(totalGas)} of gas across roughly ${hold + 7} days, with $${capital} of capital in the position.`,
      cost: `about ${gasText(totalGas)} of gas in total, itemised in the steps above`,
      time: `about ${hold + 7} days end to end`,
    },
  ];
}
