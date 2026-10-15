# Kurzanleitung qPCR Tool

## 1. Datei laden
QuantStudio-Export (`…_export.xlsx`) ins Fenster ziehen. Die Ct-Werte werden aus
dem Sheet **Results** gelesen. Mehrere Platten: über **Add plate** dazuladen.
Die Daten bleiben auf deinem Rechner, es wird nichts hochgeladen.

## 2. Gene festlegen (links, „Genes“)
- **Ref.** = Housekeeping-Gen(e), z. B. RPLP0. Bei mehreren wird der Mittelwert der Ct-Werte verwendet.
- **Target** = Gene, die ausgewertet werden sollen.

## 3. Proben und Gruppen prüfen („Samples & groups“)
Die Sample-Namen werden automatisch zerlegt: `chKO2` → Bedingung `chKO`, Replikat 2.
- **Group** = was verglichen wird (z. B. WT vs. KO).
- **Panel** (optional) = Aufteilung, z. B. nach Zelllinie (undiff / ch / o). Referenz und Statistik werden pro Panel berechnet.
- Mit **Swap panel ↔ group** vergleichst du stattdessen die Linien innerhalb eines Genotyps.

## 4. Referenzgruppe wählen
„RQ = 1 for“: die Kalibrator-Gruppe (z. B. WT oder undiff).

## 5. Qualitätskontrolle („Quality control“)
- Technische Ausreißer werden automatisch markiert (Standard: > 0,5 Zyklen vom Median, max. 1 von 4).
- Einzelne Wells lassen sich per Klick ausschließen. Das wird überall dokumentiert.
- Das Housekeeping-Gen sollte sich zwischen den Gruppen nicht unterscheiden (sonst erscheint eine Warnung).

## 6. Statistik
Voreinstellung: **Welch-Test** auf ΔCt (2 Gruppen) bzw. **Welch-ANOVA** mit Post-hoc-Tests
(> 2 Gruppen). Unter „Why this test?“ steht, warum. Wenn Replikat 1 in allen Gruppen
aus demselben Experiment oder Spender stammt: **Paired** wählen.

## 7. Export
- **Excel**: alle Tabellen, inklusive Prism-fertiger Spalten.
- **SVG / PNG 300 dpi**: Abbildungen (SVG ist in Illustrator/Inkscape editierbar).
- **R script**: rechnet alles in R nach (für das Supplement).
- **Methods**: Textentwurf für den Methodenteil, inklusive Referenzen.
- **Save (.json)**: speichert alle Einstellungen, um die Analyse später fortzusetzen.

## Gute Praxis
- Biologische Replikate nur mit dokumentiertem, ergebnisunabhängigem Grund ausschließen.
- Bei n = 3 pro Gruppe keine nichtparametrischen Tests verwenden (Mann-Whitney kann dann nie p < 0,05 erreichen).
- Im Paper die Version des Tools angeben (steht in jedem Export).