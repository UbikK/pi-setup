#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Install this repository's OpenCode configuration into a user config directory.

Usage: ./install-opencode.sh [--target DIR] [--force] [--dry-run]

Options:
  --target DIR  Install into DIR (default: ${XDG_CONFIG_HOME:-$HOME/.config}/opencode)
  --force       Replace colliding files, saving their previous versions in a
                timestamped .opencode-config-backup-* directory
  --dry-run     Show files that would be installed without changing anything
  -h, --help    Show this help

Credentials and OpenCode state are not copied. Without --force, the script
stops before writing if any destination file already exists.
EOF
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
target_dir="${XDG_CONFIG_HOME:-${HOME:?HOME must be set}/.config}/opencode"
force=false
dry_run=false

while (($#)); do
  case "$1" in
    --target)
      (($# >= 2)) || { echo "error: --target requires a directory" >&2; exit 2; }
      target_dir="$2"
      shift 2
      ;;
    --force)
      force=true
      shift
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$target_dir" ]] || { echo "error: target directory cannot be empty" >&2; exit 2; }

source_files=(
  "$script_dir/opencode.jsonc"
  "$script_dir/opencode/AGENTS.md"
)
relative_paths=(
  "opencode.jsonc"
  "AGENTS.md"
)

while IFS= read -r source_file; do
  [[ -n "$source_file" ]] || continue
  if [[ "$source_file" == "$script_dir/opencode/agents/"* ]]; then
    relative_path="agents/${source_file#"$script_dir/opencode/agents/"}"
  else
    relative_path="plugins/${source_file#"$script_dir/opencode/plugins/"}"
  fi
  source_files+=("$source_file")
  relative_paths+=("$relative_path")
done < <(find -L "$script_dir/opencode/agents" "$script_dir/opencode/plugins" -type f -print | sort)

for source_file in "${source_files[@]}"; do
  [[ -f "$source_file" ]] || { echo "error: required source file not found: $source_file" >&2; exit 1; }
done

collisions=()
for relative_path in "${relative_paths[@]}"; do
  destination="$target_dir/$relative_path"
  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ "$force" != true ]]; then
      collisions+=("$relative_path")
    elif [[ ! -f "$destination" || -L "$destination" ]]; then
      echo "error: --force only replaces regular files; refusing: $destination" >&2
      exit 1
    fi
  fi
done

if ((${#collisions[@]})); then
  echo "error: destination already contains configuration files:" >&2
  printf '  %s\n' "${collisions[@]}" >&2
  echo "Re-run with --force to back these files up before replacing them." >&2
  exit 1
fi

if [[ "$dry_run" == true ]]; then
  printf 'Would install into %s:\n' "$target_dir"
  printf '  %s\n' "${relative_paths[@]}"
  if [[ "$force" == true ]]; then
    echo "Existing regular files would be backed up before replacement."
  fi
  exit 0
fi

mkdir -p "$target_dir"
if [[ "$force" == true ]]; then
  backup_dir="$target_dir/.opencode-config-backup-$(date '+%Y%m%d%H%M%S')-$$"
  for relative_path in "${relative_paths[@]}"; do
    destination="$target_dir/$relative_path"
    if [[ -f "$destination" ]]; then
      mkdir -p "$backup_dir/$(dirname -- "$relative_path")"
      cp -p "$destination" "$backup_dir/$relative_path"
    fi
  done
  if [[ -d "$backup_dir" ]]; then
    printf 'Backed up replaced files to %s\n' "$backup_dir"
  fi
fi

for index in "${!source_files[@]}"; do
  source_file="${source_files[$index]}"
  relative_path="${relative_paths[$index]}"
  destination="$target_dir/$relative_path"
  mkdir -p "$(dirname -- "$destination")"
  cp -p "$source_file" "$destination"
  printf 'Installed %s\n' "$destination"
done

echo "Restart OpenCode to load the installed configuration, agents, and plugin."
