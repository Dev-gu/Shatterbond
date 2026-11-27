//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}

func hideWindow(cmd *exec.Cmd) {}
