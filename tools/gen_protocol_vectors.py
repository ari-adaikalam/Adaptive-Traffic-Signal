import json, pathlib, random
out = pathlib.Path("tests/vectors")

# An independent CRC-8: table driven, built from the polynomial, unlike the bitwise loop in the module.
TABLE=[]
for i in range(256):
    c=i
    for _ in range(8):
        c=((c<<1)^0x07)&0xFF if c&0x80 else (c<<1)&0xFF
    TABLE.append(c)
def crc(payload):
    c=0
    for b in payload.encode("ascii"): c=TABLE[c^b]
    return c
assert crc("123456789")==0xF4
def line(payload, crc_text=None, prefix="V3 ", end="\n"):
    return f"{prefix}{payload} {crc_text if crc_text is not None else format(crc(payload),'02X')}{end}"

VEH={"R":"red","Y":"yellow","G":"green","F":"flash"}
PED={"S":"stop","W":"walk","C":"clear"}
MOV=[f"{k}{n}" for k in "TRLC" for n in range(1,5)]
def words(payload):
    return {m:(PED if m[0]=="C" else VEH)[ch] for m,ch in zip(MOV,payload)}

valid=["RRRRRRRRRRRRSSSS","GRGRRRRRRRRRSWSW","YRYRRRRRRRRRSCSC","GRYRRRRRRRRRSSSS","RRRRRGRGRRRRSSSS","RRRRGRGRRRRRSSSS","RRRRYRYRRRRRSSSS",
       "RGRGRRRRRRRRWSWS","FFFFFFFFFFFFSSSS","RRRRRRRRRRRRWWWW","RRRRRRRRRRRRCWSC","GRGRRRRRRRRRSSSS"]
LEFT_VALID=["RRRRRGRGGRGRSSSS","RRRRRYRYYRYRSSSS","RRRRRRRRGGGGSSSS","RRRRGRGRRGRGSSSS","RRRRYRYRRYRYSSSS","FFFFFFFFFFFFSSSS","RRRRRRRRGRGRSSSS","GRGRRRRRGRGRSSSS"]
LEFT_CONFLICT=["RRRRGRGRGRGRSSSS","RRRRRGRGRGRGSSSS","GRGRRRRRRGRRSSSS","RGRGRRRRGRRRSSSS","RRRRRRGRGRRRSSSS","RRRRRRRRGRRRWSSS","RRRRRRRRGRRRSSSW","FFFFFFFFFFFRSSSS","FFFFFFFFFFFFWSSS","RRRRRRRRRYRRSSWS","GRGRRRRRRGRGSSSS"]
cases={"valid":[{"line":line(p),"payload":p,"signals":words(p)} for p in valid]}
cases["valid"] += [{"line":line(p),"payload":p,"signals":words(p)} for p in LEFT_VALID]
cases["valid"] += [
 {"name":"no newline","line":line("GRGRRRRRRRRRSWSW",end=""),"payload":"GRGRRRRRRRRRSWSW","signals":words("GRGRRRRRRRRRSWSW")},
 {"name":"carriage return and newline","line":line("GRGRRRRRRRRRSWSW",end="\r\n"),"payload":"GRGRRRRRRRRRSWSW","signals":words("GRGRRRRRRRRRSWSW")},
]
conflict=["GGRRRRRRRRRRSSSS","GRRRGRRRRRRRSSSS","GRGRRRRRRRRRWSSS","RRRRGGRRRRRRSSSS","FRRRRRRRRRRRSSSS","FFFFFFFRRRRRSSSS",
          "FFFFFFFFFFFFWSSS","FFFFFFFFFFFFSSSC","YYYYRRRRRRRRSSSS","GRRGRRRRRRRRSSSS","GGGGGGGGRRRRSSSS",
          "RGRGRRRRRRRRSWSS","GRGRRRRRRRRRCSSS"]
conflict=[p for p in conflict+LEFT_CONFLICT if len(p)==16]
cases["conflict"]=[{"line":line(p),"payload":p} for p in conflict]
good="GRGRRRRRRRRRSWSW"; gc=format(crc(good),"02X")
fmt=[
 line(good,prefix="V2 "),line(good,prefix="v3 "),f"V3{good} {gc}\n",f"V3  {good} {gc}\n",
 line(good[:-1]),line(good+"S"),line("XRGRRRRRRRRRSWSW"),line("WRGRRRRRRRRRSWSW"),line("GRGRRRRRRRRRGWSW"),
 line("grgrrrrrrrrrswsw"),line("GRGRRRRRRRRRSWSX"),
 f"V3 {good} {gc.lower()}\n" if gc.lower()!=gc else f"V3 {good} {gc}x\n",
 f"V3 {good} {gc[0]}\n",f"V3 {good} {gc}0\n",f"V3 {good} {gc[0]}G\n",
 line(good,crc_text=format((crc(good)+1)&0xFF,"02X")),line(good,crc_text="00") if gc!="00" else line(good,crc_text="01"),
 f"V3 {good}{gc}\n",f"V3 {good}  {gc}\n",f"V3 {good} {gc}\nX",f"V3 {good} {gc} \n",f" V3 {good} {gc}\n",
 "","\n","\r\n","V3 \n","V3",
 "A"*25,
 line(good).replace("\n","\r\r\n"),
]
cases["format"]=[l for l in fmt]
cases["format_bytes"]=[list("V3 GRGRRRRRRRRRSS".encode()+b"\xc3\xa9S "+gc.encode()+b"\n")]
# encode: signals that encode must refuse
base=words("RRRRRRRRRRRRSSSS")
def with_(**kw):
    d=dict(base); d.update(kw); return d
cases["encode_refuses"]=[
 {"name":"two crossing streams","signals":with_(T1="green",T2="green")},
 {"name":"walk against a green","signals":with_(T1="green",T3="green",C1="walk")},
 {"name":"mixed flash","signals":with_(T1="flash")},
 {"name":"walk during flash","signals":dict(words("FFFFFFFFFFFFSSSS"),C1="walk")},
 {"name":"unknown state","signals":with_(T1="blue")},
 {"name":"pedestrian word on a head","signals":with_(T1="walk")},
 {"name":"vehicle word on a crossing","signals":with_(C1="green")},
 {"name":"missing signal","signals":{k:v for k,v in base.items() if k!="C4"}},
 {"name":"extra signal","signals":dict(base,X9="red")},
]
# Random damaged lines for cross-language parity: single changes to valid lines.
rng=random.Random(11)
alphabet="V3 RYGFSWCABXZ0123456789abcdef\r\n"
fuzz=[]
seed_lines=[c["line"] for c in cases["valid"]]+[c["line"] for c in cases["conflict"]]
for _ in range(3000):
    l=list(rng.choice(seed_lines))
    for _ in range(rng.choice([1,1,1,2,3])):
        op=rng.random()
        if op<0.5 and l: l[rng.randrange(len(l))]=rng.choice(alphabet)
        elif op<0.7 and l: del l[rng.randrange(len(l))]
        else: l.insert(rng.randrange(len(l)+1),rng.choice(alphabet))
    fuzz.append("".join(l))
cases["fuzz_lines"]=fuzz
# What the Python implementation says about each damaged line. This records a cross-language
# parity oracle for the JavaScript port. The hand-written vectors above stay independent of it.
import sys
sys.path.insert(0, ".")
from traffic_controller import decode, FormatError, ConflictError
def verdict(text):
    try: decode(text.encode("latin-1")); return "ok"
    except FormatError: return "format"
    except ConflictError: return "conflict"
cases["fuzz_expect"]=[verdict(t) for t in fuzz]
(out/"protocol_v3.json").write_text(json.dumps(cases,indent=1))
print({k:len(v) for k,v in cases.items()})
