/**
 * Every database and storage path is built here.
 *
 * Path segments are validated against a strict pattern first: a workspace id is
 * hex, an item id is base64url, a pairing code is from a fixed alphabet. That
 * removes any route by which user input could reach a path it was not meant to
 * (`../`, `/`, `.`, `#`, `$`, `[`, `]` are all rejected rather than escaped).
 */

import { DB_ROOT, STORAGE_ROOT } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import type { Workspace } from '@/types';

const HEX_ID = /^[0-9a-f]{16,64}$/;
const ITEM_ID = /^[A-Za-z0-9_-]{8,64}$/;
const PAIR_CODE = /^[A-Z0-9]{4,16}$/;

export function assertWorkspaceId(id: string): string {
  if (!HEX_ID.test(id)) throw new AppError('workspace-invalid');
  return id;
}

export function assertItemId(id: string): string {
  if (!ITEM_ID.test(id)) throw new AppError('workspace-invalid');
  return id;
}

export function assertPairCode(code: string): string {
  if (!PAIR_CODE.test(code)) throw new AppError('peer-failed');
  return code;
}

/** Database path holding a workspace's items. */
export function itemsPath(workspace: Workspace): string {
  return workspace.kind === 'public'
    ? DB_ROOT.publicItems
    : `${DB_ROOT.privateWorkspaces}/${assertWorkspaceId(workspace.id)}/items`;
}

export function itemPath(workspace: Workspace, itemId: string): string {
  return `${itemsPath(workspace)}/${assertItemId(itemId)}`;
}

export function workspaceMetaPath(workspace: Workspace): string {
  return workspace.kind === 'public'
    ? 'workspaces/public/metadata'
    : `${DB_ROOT.privateWorkspaces}/${assertWorkspaceId(workspace.id)}/metadata`;
}

/** Storage prefix. Mirrors the database layout so rules stay easy to read. */
export function storagePrefix(workspace: Workspace): string {
  return workspace.kind === 'public'
    ? STORAGE_ROOT.public
    : `${STORAGE_ROOT.private}/${assertWorkspaceId(workspace.id)}`;
}

export function storageObjectPath(workspace: Workspace, itemId: string, safeName: string): string {
  return `${storagePrefix(workspace)}/${assertItemId(itemId)}/${safeName}`;
}

export function signalPath(code: string): string {
  return `${DB_ROOT.signals}/${assertPairCode(code)}`;
}
