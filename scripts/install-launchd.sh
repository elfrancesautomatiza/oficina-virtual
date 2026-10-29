#!/usr/bin/env bash
# Installe un job launchd par routine activée, pour qu'elles tournent même si l'app est fermée.
# Usage : bash scripts/install-launchd.sh        (relancer après avoir changé les horaires)
#         bash scripts/install-launchd.sh --remove
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
DEST="$HOME/Library/LaunchAgents"
mkdir -p "$DEST" "$ROOT/logs"

for f in "$DEST"/com.oficina-virtual.*.plist; do
  [ -e "$f" ] || continue
  launchctl unload "$f" 2>/dev/null || true
  rm -f "$f"
done
[ "${1:-}" = "--remove" ] && { echo "Jobs de launchd eliminados."; exit 0; }

"$NODE" -e '
const fs=require("fs"),path=require("path");
const root=process.argv[1];
for(const office of fs.existsSync(path.join(root,"offices"))?fs.readdirSync(path.join(root,"offices")):[]) for(const slug of fs.readdirSync(path.join(root,"offices",office,"agents"))){
  const f=path.join(root,"offices",office,"agents",slug,"agent.json"); if(!fs.existsSync(f)) continue;
  const a=JSON.parse(fs.readFileSync(f,"utf8"));
  for(const r of a.routines){ if(!r.enabled) continue;
    let [h,m]=r.time.split(":").map(Number);
    if(r.tz){ // heure dans le fuseau de la routine → heure locale du Mac (décalage calculé aujourd'hui ; relancer ce script après un changement d'heure)
      const now=new Date(); const at=(tz)=>new Date(now.toLocaleString("en-US",{timeZone:tz}));
      const diffMin=Math.round((at(Intl.DateTimeFormat().resolvedOptions().timeZone)-at(r.tz))/60000);
      let total=(h*60+m+diffMin+1440)%1440; h=Math.floor(total/60); m=total%60; }
    const days=r.days.length?r.days:[0,1,2,3,4,5,6];
    const cal=days.map(d=>`<dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer><key>Weekday</key><integer>${d}</integer></dict>`).join("");
    const label=`com.oficina-virtual.${office}.${slug}.${r.id}`;
    const plist=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${process.argv[2]}</string><string>${root}/scripts/run-routine.mjs</string><string>${office}/${slug}:${r.id}</string></array>
<key>WorkingDirectory</key><string>${root}</string>
<key>StartCalendarInterval</key><array>${cal}</array>
<key>StandardOutPath</key><string>${root}/logs/${office}-${slug}-${r.id}.log</string>
<key>StandardErrorPath</key><string>${root}/logs/${office}-${slug}-${r.id}.err.log</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.HOME}/.local/bin</string></dict>
</dict></plist>`;
    const out=path.join(process.argv[3],label+".plist"); fs.writeFileSync(out,plist); console.log("instalado",label,r.time,days.join(","));
  }
}' "$ROOT" "$NODE" "$DEST"

for f in "$DEST"/com.oficina-virtual.*.plist; do [ -e "$f" ] && launchctl load "$f"; done
echo "OK. Nota: si la app Oficina Virtual está abierta a la hora prevista, también lanza la rutina; el bloqueo interno evita duplicados dentro de la misma app, pero no entre la app y launchd. Usa uno u otro."
