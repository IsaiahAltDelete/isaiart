#!/bin/sh
# Render several models and tile them: sh sheet.sh out.png "name1 name2 ..." [cols]
OUT="$1"; NAMES="$2"; COLS="${3:-4}"; TMP="$(dirname "$OUT")/_sheet"; mkdir -p "$TMP"; i=0; FILES=""
for n in $NAMES; do
  f="$TMP/$i.png"; VW=${VW:-480} VH=${VH:-420} "F:/Blender/blender.exe" -b --factory-startup -P "$(dirname "$0")/cli.py" -- preview "$n" "$f" "${SHOW:-}" "${HIDE:-}" 2>&1 | grep -E "Error|Traceback|File \"|Exception" ; FILES="$FILES $f"; i=$((i+1))
done
python -c "
import sys; from PIL import Image, ImageDraw
fs=sys.argv[3:]; cols=int(sys.argv[2]); names=sys.argv[1].split()
ims=[Image.open(f) for f in fs]; w,h=ims[0].size; rows=(len(ims)+cols-1)//cols
S=Image.new('RGB',(w*cols,h*rows),(255,255,255)); d=ImageDraw.Draw(S)
for k,im in enumerate(ims): S.paste(im,((k%cols)*w,(k//cols)*h)); d.text(((k%cols)*w+8,(k//cols)*h+6),names[k],fill=(0,0,0))
S.save('$OUT')" "$NAMES" "$COLS" $FILES
