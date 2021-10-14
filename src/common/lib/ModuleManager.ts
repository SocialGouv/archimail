import type { Module } from "../core/modules/Module";

export const loadModules = async (...mods: Module[]): Promise<void> => {
    await Promise.all(
        mods.map(async (mod) => {
            await mod.init().catch((error) => {
                throw new Error(
                    `<MODULE_ERROR> ${mod.constructor.name} failed init.\n${error}`
                );
            });
        })
    ).catch((error) => {
        console.error(`<APP_ERROR> Cannot load modules.\n${error}`);
    });
};
