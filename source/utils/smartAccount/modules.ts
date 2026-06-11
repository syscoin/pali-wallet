import type {
  ISmartAccountMetadata,
  SmartAccountExecutorModule,
  SmartAccountValidatorModule,
} from 'types/network';

export const getInstalledValidatorModule = <
  T extends SmartAccountValidatorModule
>(
  metadata: ISmartAccountMetadata,
  id: T['id']
): T | undefined =>
  metadata.installedModules?.find(
    (module): module is T => module.type === 'validator' && module.id === id
  );

export const getInstalledExecutorModule = <
  T extends SmartAccountExecutorModule
>(
  metadata: ISmartAccountMetadata,
  id: T['id']
): T | undefined =>
  metadata.installedModules?.find(
    (module): module is T => module.type === 'executor' && module.id === id
  );

export const listInstalledValidatorModules = (
  metadata: ISmartAccountMetadata
): SmartAccountValidatorModule[] =>
  (metadata.installedModules?.filter(
    (module) => module.type === 'validator'
  ) as SmartAccountValidatorModule[]) || [];

/**
 * Address-keyed lookup that works for both builtin and custom validators
 * (custom modules have no stable registry id, only an address).
 */
export const getInstalledValidatorModuleByAddress = (
  metadata: ISmartAccountMetadata,
  address: string
): SmartAccountValidatorModule | undefined =>
  listInstalledValidatorModules(metadata).find(
    (module) => module.address.toLowerCase() === address.toLowerCase()
  );
