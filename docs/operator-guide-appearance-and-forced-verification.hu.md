# Operátori útmutató: színezés, landing/hero elemek és kötelező hitelesítés

Kinek szól: a Friending tulajdonosának és az adminisztrátoroknak, akik
országonként állítják be az app kinézetét, és akik eldöntik, mikor válik
kötelezővé a hitelesítés. Mérnöki tudás nem kell hozzá. A dokumentum angol
ikerpárja: `operator-guide-appearance-and-forced-verification.en.md`; ugyanazokat
a képernyőket írják le.

Két konzolról van szó:

1. **Megjelenés és elhelyezések** (`/appearance`) — már élesben van. A landing
   képernyő, a Discover hero-körhinta és a világos/sötét kiemelőszín-paletta,
   App Store áruház-országonként vagy földrajzi területenként.
2. **Hitelesítés → Kötelező hitelesítés és Váróterem** — az a fül, amely
   kötelezővé teszi a hitelesítést. Rejtve marad, amíg a kiadási kapcsolót be
   nem kapcsolják; mielőtt ezt kéred, olvasd el a végén a bevezetési szabályt.

Amit itt módosítasz, azt a Core tárolja, az e-mail-címeddel bekerül az
audit-naplóba, és app-frissítés nélkül érvényesül a tagoknál.

---

## 1. Megjelenés és elhelyezések

### 1.1 Hogyan épülnek egymásra a szintek

Négy szint válaszol arra a kérdésre, hogy „mit lásson ez a tag?", és az első
illeszkedő nyer:

| Szint | Mikor illeszkedik | Tipikus használat |
|---|---|---|
| Geo szabály | A tag éppen egy városban vagy térképkörön belül van | Városi kampány, fesztivál, nyitóesemény |
| Áruház-ország szabály | A tag App Store áruház-országa (ahol az Apple-fiókja vásárol) | Országos megjelenés |
| Globális szabály | Mindenki | Az állandó alap megjelenés |
| Beépített alapértékek | Nincs beállítva semmi | Az appba fordított márkaszínek |

Két ökölszabály:

- **Az üres mező öröklést jelent, nem ürességet.** Amit üresen hagysz, azt az
  alatta lévő szintről veszi. Csak azt töltöd ki, ami tényleg eltér.
- **A geo erősebb az áruház-országnál, az pedig a globálisnál.** Ha két azonos
  fajtájú szabály fedi egymást, az általad megadott prioritás dönt; két azonos
  prioritású geo szabálynál a közelebbi középpont nyer, majd a kisebb sugár,
  majd az újabb szabály.

Az oldalon a szabálylista pontosan ebben a feloldási sorrendben jelenik meg,
így fentről lefelé olvasva látod, mit fog kapni egy tag.

### 1.2 A globális szabály az első

Mindig pontosan egy globális szabály van, és nem törölhető. Ez adja az alapot,
amelyből minden felülírás örököl, ezért ezt állítsd be rendesen, mielőtt bármi
mást létrehoznál: a landing hátteret, a hero-körhintát és mindkét palettát.

### 1.3 Áruház-ország szabály létrehozása

Akkor használd, ha egy egész ország nézzen ki másképp — például más landing kép
az Egyesült Államokban.

1. Nyomd meg az **Új szabály** gombot, és válaszd az **Áruház-ország**
   hatókört.
2. Válaszd ki az országot. Ez az **App Store áruház-ország**, vagyis a tag
   Apple-fiókjának országa — nem a jelenlegi tartózkodási helye és nem a
   telefonszáma. Egy New Yorkban nyaraló magyar tag továbbra is a magyar
   áruház-ország szabályát kapja.
3. Csak azokat a mezőket töltsd ki, amelyek eltérnek a globális szabálytól. A
   többit hagyd üresen, hogy tovább örököljön.
4. Állítsd be a **Prioritást**, ha egy másik áruház-ország szabály is
   lefedhetné ugyanazt az országot.
5. Amíg összeállítod, hagyd a szabályt **inaktívan**.

### 1.4 Geo szabály létrehozása (térképválasztó és városkeresés)

Akkor használd, ha a tag *pillanatnyi helyzete* döntsön, például egy budapesti
hétvégi kampánynál.

1. Nyomd meg az **Új szabály** gombot, és válaszd a **Geo** hatókört.
2. Írj be egy várost a keresőbe, és válassz egy találatot. A középpont
   koordinátái, a javasolt sugár, a címke és az ország automatikusan kitöltődik.
   A keresésre a Core válaszol, nem a böngésző.
3. Finomíts a jelölő húzásával a térképen, vagy írd be közvetlenül a
   koordinátákat. Állítsd be a **sugarat kilométerben** — a térképen látható kör
   az, amihez a tagokat illesztjük.
4. Ha nem jelenik meg a térkép, a konzol böngészős térképkulcs nélkül fut. Ez
   nem hiba: a koordináta- és sugármezők önmagukban pontosan meghatározzák a
   szabályt, a térkép csak kényelmi eszköz.

A tag akkor illeszkedik, ha a pillanatnyi helye a körön belülre esik, így egy
geo szabály ugyanarra a személyre utazás közben hol érvényes, hol nem.

### 1.5 Eseményablak és aktív állapot

- Az **Aktív** dönti el, hogy a Core egyáltalán figyelembe veszi-e a szabályt. A
  vázlatot tartsd inaktívan, amíg a média és a szöveg jóvá nincs hagyva.
- A **kezdet** és a **vég** megadása nem kötelező. Együtt eseményablakot
  alkotnak: a szabály csak ezen belül old fel, a kezdő pillanatot beleértve, a
  záró pillanatot kizárva. Helyi idő szerint írd be; a szerkesztő alatta
  megmutatja az UTC megfelelőt, a szerver ezt tárolja.
- Az ablakán kívüli szabály egyszerűen kimarad, és a következő szint érvényesül.
  Ez nem hibaállapot, az esemény után nincs teendő vele.

### 1.6 A landing képernyő

A mezők, mindegyik önállóan öröklődik, ha üresen hagyod:

- **Háttér**: kép vagy videó. A videóhoz tartozhat **poszter** — az az állókép,
  amely a videó betöltése alatt látszik. A posztert csak videóháttér fölött
  használjuk; képháttérnél figyelmen kívül marad.
- **Cím**: vagy szöveg mindkét nyelven, vagy képcím (logószerű kép). A kép
  nélküli képcímet mentéskor visszautasítjuk, ahelyett hogy törött kép menne ki
  a tagoknak.
- **Leírás**: szöveg mindkét nyelven.

A szöveges mezőket mindig töltsd ki angolul és magyarul is. Az angol a
tartalék: aki bármilyen harmadik nyelvre állította a telefonját, az angol
szöveget látja.

A szerkesztő melletti telefon-előnézettel ellenőrizd a *feloldott* eredményt,
vagyis a szabályodat az örökölt tartalom tetején.

### 1.7 A Discover hero-körhinta

Minden szabály vagy **örökli** a körhintát, vagy **lecseréli** a saját, sorrendbe
állított kártyáira. A cserét csak akkor válaszd, ha ez a közönség tényleg más
körhintát lásson; részleges összefésülés nincs.

- A kártyák képek vagy videók, kétnyelvű szöveggel és opcionális tipográfiával.
- Az általad megadott sorrendben lapoznak a tagok.
- Az **üres csere elrejti a körhintát** az illeszkedő tagok elől. Ez jogos
  választás, de győződj meg róla, hogy szándékos.

### 1.8 Világos és sötét paletta

Módonként öt színszerep:

| Szerep | Hol látszik |
|---|---|
| Fő kiemelőszín | Elsődleges gombok, aktív fül, kiemelések |
| Lenyomott | A kiemelőszín, amíg a gombot nyomva tartják |
| Halvány háttér | Színezett háttér a kiemelt blokkok mögött |
| Kiemelésen lévő szöveg | Kiemelőszínű felületre nyomtatott feliratok |
| Inaktív | Letiltott vezérlők és inaktív fülek |

Minden szerep vagy **örökölt**, vagy `#RRGGBB` színre állított ebben a
szabályban. Csak azoknál a szerepeknél vedd ki az *Öröklés* pipát, amelyeket ez
a szabály módosítson. Mindkét mód kimegy az appba, ezért mentés előtt nézd meg a
világos és a sötét előnézetet is — és mindenekelőtt tartsd olvashatónak a
**kiemelésen lévő szöveget** a kiemelőszínen, mindkét módban.

### 1.9 Előnézet tesztelt helyre

Élesítés előtt használd az előnézet-panelt. Add meg az áruház-országot és a
koordinátákat úgy, ahogy egy valódi eszköz küldené, vagy egy IP-címet, és a Core
pontosan azt adja vissza, amit az app kapna: melyik szabály illeszkedett, a
feloldott landing, a hero-lista és a palettaminták.

Ezt a Core számolja, nem a böngésző, tehát a futtatás pillanatában tárolt
szabályokat tükrözi. Ez az őszinte végső ellenőrzés — ezt hidd el, ne a
szerkesztő előnézeteit.

### 1.10 Mentés: ütközés és bizonytalan eredmény

Minden mentés magával viszi a betöltött revíziószámot, így két adminisztrátor
sosem írja felül egymást észrevétlenül.

- **Siker**: a visszajelzés megnevezi a szabályt és az új revíziót.
- **Ütközés (HTTP 409)**: valaki más módosította a szabályt, miután megnyitottad.
  A vázlatod *nem* íródott ki. Töltsd újra a szabályt, alkalmazd rá ismét a
  módosításodat a friss tartalmon, és ments.
- **Bizonytalan eredmény** (időtúllépés, megszakadt kapcsolat): a válasz nem
  érkezett meg, így senki nem tudja, kiíródott-e. A konzol szándékosan a hiteles
  állapotot tölti újra, ahelyett hogy kétszer küldené el ugyanazt. Nézd meg, mit
  mutat az újratöltött szabály, és utána dönts. Ezért nem fordulhat elő, hogy egy
  szabály kétszer jön létre.

---

## 2. Hitelesítés → Kötelező hitelesítés és Váróterem

Ez a fül teszi kötelezővé a hitelesítést. Amíg nincs bekapcsolva, semmi nem
érinti a tagokat; maga a fül is rejtve marad, amíg a kiadásért felelős be nem
kapcsolja a kiadási kapcsolót.

### 2.1 Mit jelent a tagnak a „kötelező"

Az a tag, aki nem teljesítette a követelményt, a **Váróterembe** kerül: egy
teljes képernyős oldalra, amely az app szokásos felületeit váltja fel. Innen
elindíthatja a hitelesítést, elérheti a támogatást, kijelentkezhet vagy
törölheti a saját fiókját — mást nem. A szokásos böngészés, a csevegés és a
profilok zárva vannak, amíg nem hitelesít.

Ez súlyos kapcsoló. Mielőtt bárhol bekapcsolod, olvasd el a 2.6 pontot.

### 2.2 Globális alapérték és áruház-országos felülírások

- A **globális alapérték** adja meg, mely módszerek kötelezők mindenkinek.
- Az **áruház-országos felülírás** ezt a teljes halmazt cseréli le egyetlen App
  Store áruház-országra. Ez csere, nem hozzáadás: ha a globális alapérték a
  Personát követeli meg, egy egyesült államokbeli felülírás pedig csak a videót,
  akkor az amerikai tagoktól csak videót kérünk.
- Az az áruház-ország, amelyhez nincs felülírás, a globális alapértéket követi.

### 2.3 „Bármelyik" logika

Ha egynél több módszer kötelező, a tagnak **bármelyik egy** teljesítése elég —
nem mind. A Persona *vagy* egy aktív videós hitelesítési jelvény *vagy* egy
aktív, adminisztrátor által adott hitelesítés egyaránt megnyitja az appot. Két
módszer bepipálása tehát szélesíti a tag választását, nem duplázza a terhet.

### 2.4 A szövegszerkesztő

A Váróterem szövege — cím, alcím és leírás — angolul és magyarul is
szerkeszthető; a globális alapértéknél mindkettő kötelező.

Áruház-országonként a három mező bármelyikét külön felülírhatod; az üresen
hagyott mező az azonos nyelvű globális szöveget örökli. Tartsd tényszerűnek a
megfogalmazást: a kizárt tag csak ezt a magyarázatot látja.

Nyelvenként egy opcionális **súgó URL** is megadható (a szerződés 1.5-ös
módosítása). Ha ki van töltve, a Váróterem jobb felső sarkában kerek „?" gomb
jelenik meg, amely az alkalmazáson belüli böngészőben, a terem fölött nyitja meg
a címet; üresen hagyva nincs gomb. A címnek `https://`-sel kell kezdődnie,
legfeljebb 2048 bájt lehet, és nem tartalmazhat hitelesítő adatokat. Az üresen
hagyott áruház-országos felülírás a globális URL-t örökli, pontosan úgy, mint a
három szövegmező, a telefonos előnézet pedig csak ott mutatja a gombot, ahol
tényleges URL van. Az URL csak megjelenítés: sosem engedi át a tagot a kapun.

Két gyakorlati megjegyzés:

- A szélső hagyományos szóközöket automatikusan levágjuk. Az olyan „szóközt",
  amely nem törhető vagy más Unicode szóköz, viszont visszautasítjuk, mert
  üresnek látszana anélkül, hogy üres lenne. Ha egy beillesztett szöveget ezért
  utasít vissza a rendszer, gépeld újra a szélét kézzel.
- A szerkesztő melletti előnézet világos és sötét módban mutatja a telefon
  képernyőjét. Ha egy mező még nem érvényes, az előnézet arra a mezőre a beépített
  szöveget mutatja, és ezt jelzi is, hogy mindig valósághű képet láss.

### 2.5 Hatás-előnézet

Mentés előtt a hatás-előnézet megkérdezi a Core-tól, hány tagot tenne a vázlat a
Váróterembe, áruház-országonként lebontva. Csak darabszámokat ad vissza — soha
nem neveket vagy tagi adatokat.

A nagy számot üzleti döntésként kezeld, ne technikai részletként: ezek a tagok
elveszítik a hozzáférést az apphoz, amíg nem hitelesítenek.

### 2.6 A bevezetési szabály — ezt ne hagyd ki

**A kötelezővé tételt csak azután kapcsold be, hogy a Váróteremet tartalmazó iOS
build már elérhető az App Store-ban.**

Az ok egyszerű. A kaput a szerver érvényesíti, minden app-verzióra. Egy régebbi
app, amely nem ismeri a Váróteremet, megkapja az elutasítást, de nincs mit
megjelenítenie hozzá, így a tag zsákutcát lát a hitelesítés lehetősége helyett. A
tagok nem ugyanazon a napon frissítenek, ezért:

1. A Váróteremmel készült iOS kiadás megjelenik az App Store-ban.
2. Várj, amíg az aktív tagok túlnyomó többsége erre frissül (nézd meg az
   analitikát; néhány nap a szokásos).
3. Csak ezután kapcsold be a kötelezővé tételt, és lehetőleg először egyetlen
   áruház-országban.
4. Bővítés előtt egy napig figyeld a támogatási megkeresések mennyiségét.

A visszakapcsolás azonnali és biztonságos: a tagok a következő kérésüknél
visszakerülnek az appba.

### 2.7 Mentés

A mentés pontosan úgy működik, mint a megjelenés-konzolon: a vázlat magával
viszi a betöltött revíziót, az ütközés azt jelenti, hogy valaki más módosította a
beállításokat és a vázlatod nem íródott ki, a bizonytalan eredmény pedig a
hiteles állapotot tölti újra ahelyett, hogy kétszer írna.

---

## 3. Gyors válaszok

**Egy tag szerint rosszul néz ki az app az országában.** Futtasd a teszt-
előnézetet az ő áruház-országával és helyével. Az illeszkedő szabály megmondja,
melyik szint a felelős.

**Egy kampánynak ma este véget kell érnie.** A szabály törlése helyett állítsd be
a záró pillanatot az eseményablakban; magától megszűnik feloldani, és az alatta
lévő szint veszi át.

**Azt szeretném, hogy egy ország megtartsa a régi kinézetet.** Adj annak az
áruház-országnak egy szabályt, amely pontosan a globálisan módosított mezőket
állítja vissza a régi értékekre.

**A színek világos módban jók, sötétben olvashatatlanok.** A két mód külön van;
ellenőrizd a „kiemelésen lévő szöveget" a sötét előnézetben.

**Eljutott a módosításom a tagokhoz?** A szabálylista mutatja az élő állapotot; a
teszt-előnézet pedig pontosan azt, amit egy eszköz most kapna.
