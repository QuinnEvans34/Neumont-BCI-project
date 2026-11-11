import test from "node:test";
import assert from "node:assert/strict";
import { contactQuality } from "../apps/web/src/contactQuality.ts";

const good = { channel: 7, included: true, selected: true, reason: "Included", std_uv: 12, ptp_uv: 45, hum_rms_uv: 2 };
test("clean metrics pass screening only while samples are current", () => {
  assert.equal(contactQuality(good,true,150).tone,"usable");
  assert.equal(contactQuality(good,false,150).tone,"waiting");
  assert.equal(contactQuality(undefined,true,150).tone,"waiting");
  assert.equal(contactQuality(good,true,150,10,"Counter gap").label,"Sample gap");
});
test("flat, invalid and saturated channels cannot look healthy because hum is low", () => {
  assert.equal(contactQuality({...good,std_uv:0},true,150).label,"Flat signal");
  assert.equal(contactQuality({...good,std_uv:NaN},true,150).label,"Invalid signal");
  assert.equal(contactQuality({...good,reason:"Raw signal near Cyton input rail"},true,150).label,"Signal saturated");
});
test("hum advisory catches interference even when filtered amplitude passes", () => {
  const noisy = {...good,hum_rms_uv:20};
  assert.equal(contactQuality(noisy,true,150).label,"Mains interference");
  assert.equal(contactQuality(noisy,true,150,50).tone,"usable");
  assert.equal(contactQuality({...good,ptp_uv:150},true,150).label,"Large fluctuations");
  assert.equal(contactQuality({...good,hum_rms_uv:undefined},true,150).tone,"waiting");
});
test("excluding a channel from the score does not hide its contact screening", () => {
  const excluded = {...good,selected:false,included:false,reason:"Not selected for scoring"};
  assert.equal(contactQuality(excluded,true,150).tone,"usable");
  assert.equal(contactQuality({...excluded,hum_rms_uv:25},true,150).tone,"check");
});
