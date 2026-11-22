export type Role = 'owner' | 'admin' | 'member'
export type ProjectRole = 'editor' | 'viewer'

export interface Profile {
  id: string
  email: string | null
  username: string | null
  display_name: string | null
  avatar_url: string | null
  color: string
}

export interface Studio { id: string; name: string; owner_id: string; created_at: string }
export interface StudioMember { studio_id: string; user_id: string; role: Role; added_at: string; profiles?: Profile | null }
export interface StudioInvite { id: string; studio_id: string; email: string; role: 'admin' | 'member'; created_at: string }

export interface Project {
  id: string; studio_id: string; name: string; description: string; color: string
  archived: boolean; created_by: string | null; created_at: string; updated_at: string
}
export interface ProjectMember { project_id: string; user_id: string; role: ProjectRole; added_at: string; profiles?: Profile | null }
export interface ProjectInvite { id: string; project_id: string; email: string; role: ProjectRole; created_at: string }
export interface ProjectStats { project_id: string; total: number; done: number; overdue: number }

export interface List { id: string; project_id: string; name: string; position: number }
export interface Card {
  id: string; project_id: string; list_id: string; title: string; description: string
  position: number; due_date: string | null; completed: boolean; completed_at: string | null
  created_by: string | null; created_at: string; updated_at: string
}
export interface Label { id: string; project_id: string; name: string; color: string }
export interface CardLabel { id: string; card_id: string; label_id: string; project_id: string }
export interface CardAssignee { id: string; card_id: string; user_id: string; project_id: string }
export interface ChecklistItem { id: string; card_id: string; project_id: string; text: string; done: boolean; position: number }
export interface Attachment { id: string; card_id: string; project_id: string; name: string; path: string; size: number; mime: string; created_by: string | null; created_at: string }
export interface Comment { id: string; card_id: string; project_id: string; user_id: string; body: string; created_at: string; edited_at: string | null }
export interface Message { id: string; project_id: string; user_id: string; body: string; created_at: string }
export interface Activity {
  id: string; studio_id: string; project_id: string | null; user_id: string | null
  kind: string; title: string; meta: Record<string, unknown>; created_at: string
}

export type DeviceKind = '3ds' | 'pc'
export interface Device {
  id: string; studio_id: string; name: string; kind: DeviceKind
  config: Record<string, unknown>; info: Record<string, unknown>
  last_seen: string | null; created_at: string
}
export interface DeviceCommand {
  id: string; device_id: string; type: string; payload: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'error'
  result: any; error: string | null
}

export type Platform = 'pc' | '3ds' | 'switch' | 'mobile' | 'web' | 'other'
export type GameStatus = 'idea' | 'dev' | 'alpha' | 'beta' | 'released' | 'paused'
export interface Game {
  id: string; studio_id: string; name: string; platform: Platform; status: GameStatus
  description: string; cover_url: string | null; version: string; repo_url: string; store_url: string
  pc_path: string; device_id: string | null; project_id: string | null; created_at: string
}

export interface FileEntry { name: string; type: 'dir' | 'file'; size: number; mtime: number | null }
