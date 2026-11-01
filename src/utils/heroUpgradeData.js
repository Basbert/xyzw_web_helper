/** Read only the current account's loaded heroes; missing data stays empty. */
export function heroUpgradeOptions(roleInfo, heroDictionary) {
  const heroes = roleInfo?.role?.heroes;
  if (!heroes || typeof heroes !== "object") return [];
  return Object.values(heroes)
    .filter((hero) => hero && hero.heroId != null)
    .map((hero) => ({
      label: `${heroDictionary?.[hero.heroId]?.name || `武将 ${hero.heroId}`}(${hero.level ?? "?"}/6000)`,
      value: hero.heroId,
      disabled: Number(hero.level) === 6000,
    }));
}

export function selectedUpgradeHero(roleInfo, heroId, heroDictionary) {
  if (heroId == null) return null;
  const hero = roleInfo?.role?.heroes?.[heroId];
  if (!hero || Number(hero.level) === 6000) return null;
  return { ...hero, ...heroDictionary?.[heroId] };
}
