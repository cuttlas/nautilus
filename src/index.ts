#!/usr/bin/env node
import { Command } from "commander";
import { newProjectCommand } from "./commands/new.js";

const program = new Command();

program
  .name("nautilus")
  .description("Terminal-first project execution engine")
  .version("0.1.0");

program.addCommand(newProjectCommand());

await program.parseAsync(process.argv);
