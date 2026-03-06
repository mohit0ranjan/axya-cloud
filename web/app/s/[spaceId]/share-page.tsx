'use client';

import React from 'react';
import PasswordGate from './password-gate';
import SharedFolderView from './shared-folder-view';

type Space = {
  name: string;
  allow_upload: boolean;
  allow_download: boolean;
  requires_password?: boolean;
  has_access?: boolean;
};

type FileRow = {
  id: string;
  file_name: string;
  file_size: number;
  download_url: string | null;
};

type FolderRow = { name: string; path: string };

type SharePageProps = {
  space: Space | null;
  files: FileRow[];
  folders: FolderRow[];
  folderPath: string;
  password: string;
  loading: boolean;
  error: string;
  apiBase: string;
  onPasswordChange: (value: string) => void;
  onUnlock: (e?: React.FormEvent) => void;
  onUp: () => void;
  onOpenFolder: (path: string) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export default function SharePage(props: SharePageProps) {
  const isLocked = Boolean(props.space?.requires_password && !props.space?.has_access);

  if (isLocked) {
    return (
      <PasswordGate
        folderName={props.space?.name || 'Shared Space'}
        password={props.password}
        loading={props.loading}
        error={props.error}
        onPasswordChange={props.onPasswordChange}
        onSubmit={props.onUnlock}
      />
    );
  }

  return (
    <SharedFolderView
      title={props.space?.name || 'Shared Space'}
      folderPath={props.folderPath}
      folders={props.folders}
      files={props.files}
      allowUpload={Boolean(props.space?.allow_upload)}
      allowDownload={Boolean(props.space?.allow_download)}
      loading={props.loading}
      error={props.error}
      apiBase={props.apiBase}
      onUp={props.onUp}
      onOpenFolder={props.onOpenFolder}
      onUpload={props.onUpload}
    />
  );
}
