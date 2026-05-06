/**
 * Public surface of the core/group module (Stories 9.1, 9.2, 9.4).
 */

export type {
  InviteToken,
  GroupSessionMeta,
  GroupRole,
  GroupMessage,
  GroupClient,
} from './group-types';

export {
  generateInviteToken,
  isValidInviteToken,
  normaliseInviteToken,
  buildJoinUrl,
  parseJoinUrl,
  INVITE_TOKEN_LENGTH,
  INVITE_TOKEN_ALPHABET,
  type RandomFn,
  type JoinUrlPayload,
} from './invite-token';

export {
  GroupViewModel,
  type GroupViewState,
  type GroupViewListener,
  type GroupViewModelOptions,
} from './group-viewmodel';
